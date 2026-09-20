(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FocusRecurrence = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const TYPES = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'];
    const UNITS = ['day', 'week', 'month', 'year'];
    const LABELS = {
        daily: 'Diariamente',
        weekdays: 'Dias da semana',
        weekly: 'Semanalmente',
        monthly: 'Mensalmente',
        yearly: 'Anualmente',
    };

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function formatLocalDate(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function today(date = new Date()) {
        return formatLocalDate(date);
    }

    function parseLocalDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function normalize(value) {
        if (!value || typeof value !== 'object' || !TYPES.includes(value.type)) return null;
        const normalized = { type: value.type };
        if (value.type === 'custom') {
            normalized.interval = Math.min(365, Math.max(1, Number.parseInt(value.interval, 10) || 1));
            normalized.unit = UNITS.includes(value.unit) ? value.unit : 'day';
        }
        if (typeof value.seriesId === 'string' && value.seriesId) normalized.seriesId = value.seriesId;
        if (parseLocalDate(value.nextDate)) normalized.nextDate = value.nextDate;
        if (typeof value.spawnedTaskId === 'string' && value.spawnedTaskId) normalized.spawnedTaskId = value.spawnedTaskId;
        return normalized;
    }

    function configOnly(value) {
        const normalized = normalize(value);
        if (!normalized) return null;
        const config = { type: normalized.type };
        if (normalized.type === 'custom') {
            config.interval = normalized.interval;
            config.unit = normalized.unit;
        }
        return config;
    }

    function pluralUnit(unit, amount) {
        const labels = {
            day: amount === 1 ? 'dia' : 'dias',
            week: amount === 1 ? 'semana' : 'semanas',
            month: amount === 1 ? 'mês' : 'meses',
            year: amount === 1 ? 'ano' : 'anos',
        };
        return labels[unit] || labels.day;
    }

    function getLabel(value) {
        const recurrence = normalize(value);
        if (!recurrence) return 'Não repetir';
        if (recurrence.type !== 'custom') return LABELS[recurrence.type];
        return `A cada ${recurrence.interval} ${pluralUnit(recurrence.unit, recurrence.interval)}`;
    }

    function addDays(date, amount) {
        const result = new Date(date);
        result.setDate(result.getDate() + amount);
        return result;
    }

    function addMonthsClamped(date, amount) {
        const targetMonth = date.getMonth() + amount;
        const result = new Date(date.getFullYear(), targetMonth, 1);
        const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
        result.setDate(Math.min(date.getDate(), lastDay));
        return result;
    }

    function addYearsClamped(date, amount) {
        const result = new Date(date.getFullYear() + amount, date.getMonth(), 1);
        const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
        result.setDate(Math.min(date.getDate(), lastDay));
        return result;
    }

    function getNextDate(anchorValue, value, afterValue = today()) {
        const recurrence = normalize(value);
        const anchor = parseLocalDate(anchorValue) || parseLocalDate(afterValue) || new Date();
        const after = parseLocalDate(afterValue) || new Date();
        let candidate = new Date(anchor);
        let step = 0;

        if (!recurrence) return null;

        if (recurrence.type === 'weekdays') {
            do {
                candidate = addDays(candidate, 1);
            } while (candidate <= after || candidate.getDay() === 0 || candidate.getDay() === 6);
            return formatLocalDate(candidate);
        }

        const interval = recurrence.type === 'custom' ? recurrence.interval : 1;
        const unit = recurrence.type === 'custom'
            ? recurrence.unit
            : ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' })[recurrence.type];

        do {
            step += interval;
            if (unit === 'day') candidate = addDays(anchor, step);
            if (unit === 'week') candidate = addDays(anchor, step * 7);
            if (unit === 'month') candidate = addMonthsClamped(anchor, step);
            if (unit === 'year') candidate = addYearsClamped(anchor, step);
        } while (candidate <= after && step < 10000);

        return formatLocalDate(candidate);
    }

    function getCategoryForDate(dateValue, referenceValue = today()) {
        const date = parseLocalDate(dateValue);
        const reference = parseLocalDate(referenceValue);
        if (!date || !reference) return null;
        const todayValue = formatLocalDate(reference);
        const tomorrowValue = formatLocalDate(addDays(reference, 1));
        const value = formatLocalDate(date);
        if (value === todayValue) return 'hoje';
        if (value === tomorrowValue) return 'amanha';
        return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][date.getDay()];
    }

    return {
        TYPES,
        UNITS,
        formatLocalDate,
        parseLocalDate,
        today,
        normalize,
        configOnly,
        getLabel,
        getNextDate,
        getCategoryForDate,
    };
});
