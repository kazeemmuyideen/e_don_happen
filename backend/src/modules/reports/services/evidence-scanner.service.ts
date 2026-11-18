import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type Socket } from 'node:net';

export interface EvidenceScanResult {
  state: 'clean' | 'infected' | 'error';
  engine: string;
  scannedAt: Date;
  signature?: string;
}

const INSTREAM_COMMAND = Buffer.from('zINSTREAM\0', 'ascii');
const STREAM_TERMINATOR = Buffer.alloc(4);
const CHUNK_SIZE = 64 * 1024;

@Injectable()
export class EvidenceScannerService {
  constructor(private readonly config: ConfigService) {}

  async scan(buffer: Buffer, fileName: string): Promise<EvidenceScanResult> {
    const scannedAt = new Date();
    void fileName;

    if (this.driver === 'passthrough')
      return { state: 'clean', engine: 'passthrough', scannedAt };

    if (this.driver !== 'clamav')
      return { state: 'error', engine: this.driver, scannedAt };

    try {
      const response = await this.scanWithClamAv(buffer);
      return this.interpret(response, scannedAt);
    } catch {
      return { state: 'error', engine: 'clamav', scannedAt };
    }
  }

  private scanWithClamAv(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket: Socket = connect({
        host: this.host,
        port: this.port,
      });
      let response = Buffer.alloc(0);
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        socket.destroy();
        callback();
      };

      timer = setTimeout(
        () => finish(() => reject(new Error('scanner timeout'))),
        this.timeoutMs,
      );

      socket.on('connect', () => {
        socket.write(INSTREAM_COMMAND);
        for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
          const chunk = buffer.subarray(
            offset,
            Math.min(offset + CHUNK_SIZE, buffer.length),
          );
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          socket.write(header);
          socket.write(chunk);
        }
        socket.write(STREAM_TERMINATOR);
      });

      socket.on('data', (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        const text = response.toString('utf8');
        if (text.includes('\0'))
          finish(() => resolve(text.slice(0, text.indexOf('\0'))));
      });

      socket.on('end', () => finish(() => resolve(response.toString('utf8'))));
      socket.on('error', (error) => finish(() => reject(error)));
    });
  }

  private interpret(response: string, scannedAt: Date): EvidenceScanResult {
    const text = response.replace(/\0/g, '').trim();

    if (/FOUND\b/i.test(text)) {
      const signature =
        text.match(/^stream:\s*(.+?)\s+FOUND\b/i)?.[1]?.trim() ??
        text
          .match(/(.+?)\s+FOUND\b/i)?.[1]
          ?.replace(/^.*:\s*/, '')
          .trim() ??
        undefined;
      return {
        state: 'infected',
        engine: 'clamav',
        scannedAt,
        ...(signature ? { signature } : {}),
      };
    }

    if (/\bOK\b/i.test(text))
      return { state: 'clean', engine: 'clamav', scannedAt };

    return { state: 'error', engine: 'clamav', scannedAt };
  }

  private get driver() {
    return (
      this.config.get<string>('evidence.scannerDriver') ?? 'passthrough'
    );
  }

  private get host() {
    return this.config.get<string>('evidence.scannerHost') ?? '127.0.0.1';
  }

  private get port() {
    return this.config.get<number>('evidence.scannerPort') ?? 3310;
  }

  private get timeoutMs() {
    return this.config.get<number>('evidence.scannerTimeoutMs') ?? 10_000;
  }
}
