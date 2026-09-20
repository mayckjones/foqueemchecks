const assert = require('node:assert/strict');
const recurrence = require('../assets/js/recurrence.js');

const cases = [
    ['diária', '2026-09-20', { type: 'daily' }, '2026-09-20', '2026-09-21'],
    ['dias úteis após sexta', '2026-09-18', { type: 'weekdays' }, '2026-09-18', '2026-09-21'],
    ['semanal', '2026-09-20', { type: 'weekly' }, '2026-09-20', '2026-09-27'],
    ['semanal atrasada mantém o ciclo', '2026-09-01', { type: 'weekly' }, '2026-09-20', '2026-09-22'],
    ['mensal no fim do mês', '2026-01-31', { type: 'monthly' }, '2026-01-31', '2026-02-28'],
    ['mensal não acumula desvio', '2026-01-31', { type: 'monthly' }, '2026-02-28', '2026-03-31'],
    ['anual em ano bissexto', '2024-02-29', { type: 'yearly' }, '2024-02-29', '2025-02-28'],
    ['personalizada quinzenal', '2026-09-20', { type: 'custom', interval: 2, unit: 'week' }, '2026-09-20', '2026-10-04'],
];

for (const [name, anchor, config, after, expected] of cases) {
    assert.equal(recurrence.getNextDate(anchor, config, after), expected, name);
}

assert.equal(recurrence.normalize({ type: 'invalid' }), null, 'descarta recorrência inválida');
assert.deepEqual(
    recurrence.normalize({ type: 'custom', interval: 0, unit: 'invalid' }),
    { type: 'custom', interval: 1, unit: 'day' },
    'normaliza configuração personalizada'
);
assert.equal(recurrence.getLabel({ type: 'custom', interval: 2, unit: 'month' }), 'A cada 2 meses');
assert.equal(recurrence.getCategoryForDate('2026-09-21', '2026-09-20'), 'amanha');
assert.equal(recurrence.getCategoryForDate('2026-09-21', '2026-09-21'), 'hoje');

console.log(`OK: ${cases.length} ciclos de recorrência, 3 normalizações e 2 classificações por data validados.`);
