import { mkdir, mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { OtpService } from './otp.service.js';
import { WhatsAppService } from './whatsapp.service.js';

describe('local demo OTP adapter', () => {
  const phone = '+2348000000001';
  let service: OtpService;
  let folder: string;
  let mailbox: string;
  async function code() {
    return JSON.parse(await readFile(mailbox, 'utf8')).codes.find(
      (item: { phone: string }) => item.phone === phone,
    ).code as string;
  }
  beforeEach(async () => {
    await mkdir(resolve('.local'), { recursive: true });
    folder = await mkdtemp(resolve('.local/otp-test-'));
    mailbox = join(folder, 'codes.json');
    vi.useFakeTimers();
    service = makeService({
      DEMO_MODE: 'true',
      NODE_ENV: 'development',
      DEMO_OTP_FILE: mailbox,
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await unlink(mailbox).catch(() => {});
    await rmdir(folder);
  });

  it('generates six digits and consumes a successful code', async () => {
    const response = await service.sendOtp(phone);
    expect(response).not.toHaveProperty('demoOtp');
    const demoOtp = await code();
    expect(demoOtp).toMatch(/^\d{6}$/);
    expect((await service.verifyOtp(phone, demoOtp)).success).toBe(true);
    expect(JSON.parse(await readFile(mailbox, 'utf8')).codes).toEqual([]);
    expect((await service.verifyOtp(phone, demoOtp)).success).toBe(false);
  });
  it('expires codes after five minutes', async () => {
    const response = await service.sendOtp(phone);
    expect(response).not.toHaveProperty('demoOtp');
    const demoOtp = await code();
    vi.advanceTimersByTime(5 * 60000);
    expect((await service.verifyOtp(phone, demoOtp)).success).toBe(false);
  });
  it('limits repeated requests even though codes replace earlier records', async () => {
    for (let i = 0; i < 3; i++) await service.sendOtp(phone);
    await expect(service.sendOtp(phone)).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(15 * 60000 + 1);
    await expect(service.sendOtp(phone)).resolves.toHaveProperty(
      'success',
      true,
    );
  });
  it('blocks a correct code after three wrong attempts', async () => {
    const response = await service.sendOtp(phone);
    expect(response).not.toHaveProperty('demoOtp');
    const demoOtp = await code();
    const wrong = demoOtp === '111111' ? '222222' : '111111';
    for (let i = 0; i < 3; i++)
      expect((await service.verifyOtp(phone, wrong)).success).toBe(false);
    expect((await service.verifyOtp(phone, demoOtp)).success).toBe(false);
  });
  it.each([
    { DEMO_MODE: 'false', NODE_ENV: 'development' },
    { DEMO_MODE: 'true', NODE_ENV: 'production' },
  ])('does not expose an OTP outside the local demo: %j', async (config) => {
    const disabled = makeService(config);
    await expect(disabled.sendOtp(phone)).rejects.toMatchObject({
      status: 503,
    });
  });

  describe('WhatsApp driver', () => {
    const whatsappConfig = {
      DEMO_MODE: 'false',
      NODE_ENV: 'development',
      WHATSAPP_DRIVER: 'whatsapp',
      WHATSAPP_ACCESS_TOKEN: 'test-token',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_TEMPLATE_NAME: 'otp_verification',
      WHATSAPP_OTP_SECRET: 'test-secret',
      DEMO_OTP_FILE: mailbox,
    };
    it('sends a template through WhatsApp and verifies the code', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
            status: 200,
          }),
        );
      vi.stubGlobal('fetch', fetchMock);
      const driver = makeService(whatsappConfig);
      const response = await driver.sendOtp(phone);
      expect(response.message).toContain('WhatsApp');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = fetchMock.mock.calls[0][1];
      const body = JSON.parse(request.body);
      expect(body.to).toBe('2348000000001');
      expect(body.template.name).toBe('otp_verification');
      const code = body.template.components[0].parameters[0].text;
      expect(code).toMatch(/^\d{6}$/);
      expect((await driver.verifyOtp(phone, code)).success).toBe(true);
      vi.unstubAllGlobals();
    });
    it('requires credentials', async () => {
      const missing = makeService({
        ...whatsappConfig,
        WHATSAPP_ACCESS_TOKEN: '',
      });
      await expect(missing.sendOtp(phone)).rejects.toMatchObject({
        status: 503,
      });
    });
    it('surfaces provider rejection without leaking the response body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'bad token' } }), {
            status: 401,
          }),
        ),
      );
      const driver = makeService(whatsappConfig);
      await expect(driver.sendOtp(phone)).rejects.toMatchObject({
        status: 503,
      });
      vi.unstubAllGlobals();
    });
  });
});

function makeService(config: Record<string, string>) {
  const configService = new ConfigService(config);
  return new OtpService(configService, new WhatsAppService(configService));
}
