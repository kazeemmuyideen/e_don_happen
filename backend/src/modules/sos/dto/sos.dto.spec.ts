import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSosDto } from './sos.dto.js';

describe('CreateSosDto escalation policy', () => {
  const base = {
    incidentType: 'medical',
    latitude: 6.52442,
    longitude: 3.37921,
  };

  it('accepts a valid nested escalation policy', async () => {
    const dto = plainToInstance(CreateSosDto, {
      ...base,
      escalationPolicy: {
        acknowledgeWithinMinutes: 10,
        escalateAfterMinutes: 15,
        maxLevels: 2,
        channels: ['in_app'],
      },
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects invalid nested escalation policy values', async () => {
    const dto = plainToInstance(CreateSosDto, {
      ...base,
      escalationPolicy: {
        escalateAfterMinutes: 0,
        maxLevels: 9,
        channels: ['email'],
      },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('escalationPolicy');
    expect(errors[0].children?.map((child) => child.property)).toEqual(
      expect.arrayContaining(['escalateAfterMinutes', 'maxLevels', 'channels']),
    );
  });
});
