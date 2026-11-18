import { ConfigService } from '@nestjs/config';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { EvidenceScannerService } from './evidence-scanner.service.js';

const COMMAND = Buffer.from('zINSTREAM\0', 'ascii');
const PAYLOAD = Buffer.from('evidence bytes for scan');
const EXPECTED_REQUEST_LENGTH = COMMAND.length + 4 + PAYLOAD.length + 4;

interface FakeClamd {
  port: number;
  requests: Buffer[];
  close(): Promise<void>;
}

const makeService = (values: Record<string, string | number>) =>
  new EvidenceScannerService({
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService);

const makeClamConfig = (port: number, timeoutMs = 1000) => ({
  'evidence.scannerDriver': 'clamav',
  'evidence.scannerHost': '127.0.0.1',
  'evidence.scannerPort': port,
  'evidence.scannerTimeoutMs': timeoutMs,
});

async function startFakeClamd(
  response?: Buffer,
  completeBytes?: number,
): Promise<FakeClamd> {
  const sockets = new Set<Socket>();
  const requests: Buffer[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    let received = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (
        response !== undefined &&
        completeBytes !== undefined &&
        received.length >= completeBytes
      ) {
        requests.push(received);
        socket.end(response);
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | undefined;

  return {
    port,
    requests,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      });
      return closing;
    },
  };
}

describe('EvidenceScannerService', () => {
  let fake: FakeClamd | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('returns a clean passthrough result without connecting', async () => {
    const service = makeService({
      'evidence.scannerDriver': 'passthrough',
    });

    const result = await service.scan(PAYLOAD, 'photo.png');

    expect(result).toEqual({
      state: 'clean',
      engine: 'passthrough',
      scannedAt: expect.any(Date),
    });
  });

  it('streams the buffer over INSTREAM and reports a clean scan', async () => {
    fake = await startFakeClamd(
      Buffer.from('stream: OK\0', 'ascii'),
      EXPECTED_REQUEST_LENGTH,
    );
    const service = makeService(makeClamConfig(fake.port));

    const result = await service.scan(PAYLOAD, 'photo.png');

    expect(result.state).toBe('clean');
    expect(result.engine).toBe('clamav');
    expect(result.signature).toBeUndefined();
    expect(fake.requests).toHaveLength(1);

    const request = fake.requests[0];
    expect(request.length).toBe(EXPECTED_REQUEST_LENGTH);
    expect(request.subarray(0, COMMAND.length)).toEqual(COMMAND);
    expect(request.readUInt32BE(COMMAND.length)).toBe(PAYLOAD.length);
    expect(
      request.subarray(
        COMMAND.length + 4,
        COMMAND.length + 4 + PAYLOAD.length,
      ),
    ).toEqual(PAYLOAD);
    expect(request.subarray(-4)).toEqual(Buffer.alloc(4));
  });

  it('captures the signature from a FOUND response', async () => {
    fake = await startFakeClamd(
      Buffer.from('stream: Eicar-Test-Signature FOUND\0', 'ascii'),
      EXPECTED_REQUEST_LENGTH,
    );
    const service = makeService(makeClamConfig(fake.port));

    const result = await service.scan(PAYLOAD, 'eicar.txt');

    expect(result).toEqual({
      state: 'infected',
      engine: 'clamav',
      scannedAt: expect.any(Date),
      signature: 'Eicar-Test-Signature',
    });
  });

  it('returns an error result when clamd does not respond in time', async () => {
    fake = await startFakeClamd();
    const service = makeService(makeClamConfig(fake.port, 20));

    const startedAt = Date.now();
    const result = await service.scan(PAYLOAD, 'photo.png');

    expect(result.state).toBe('error');
    expect(result.engine).toBe('clamav');
    expect(result.scannedAt).toBeInstanceOf(Date);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('returns an error result when clamd cannot be reached', async () => {
    const probe = await startFakeClamd();
    const port = probe.port;
    await probe.close();
    const service = makeService(makeClamConfig(port, 100));

    const result = await service.scan(PAYLOAD, 'photo.png');

    expect(result.state).toBe('error');
    expect(result.engine).toBe('clamav');
  });
});
