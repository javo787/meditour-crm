import { stageLabel } from './status';
import type { Stage } from './types';

describe('stageLabel', () => {
  it('returns correct label for valid stages', () => {
    expect(stageLabel('new')).toBe('Новый');
    expect(stageLabel('first_contact')).toBe('Первый контакт');
    expect(stageLabel('consult_scheduled')).toBe('Консультация назначена');
    expect(stageLabel('consult_done')).toBe('Консультация проведена');
    expect(stageLabel('estimate_sent')).toBe('Смета отправлена');
    expect(stageLabel('awaiting_decision')).toBe('Ожидание решения');
    expect(stageLabel('won')).toBe('Выиграно');
    expect(stageLabel('declined')).toBe('Отказ');
  });

  it('returns the input string if the stage is unknown', () => {
    expect(stageLabel('unknown_stage' as Stage)).toBe('unknown_stage');
    expect(stageLabel('invalid' as Stage)).toBe('invalid');
  });
});
