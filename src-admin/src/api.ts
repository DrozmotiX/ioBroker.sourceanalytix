import { I18n } from '@iobroker/gui-components';
import type { AdminConnection } from '@iobroker/socket-client';

export interface SourceValues {
    quantity: number | null;
    money: number | null;
}

export interface Finding {
    code: string;
    severity: string;
}

export interface Source {
    id: string;
    name: string;
    orphan?: boolean;
    enabled: boolean;
    active: boolean;
    sourceExists: boolean;
    sourceUnit?: string | null;
    unit?: string | null;
    calcUnit?: string | null;
    kind?: 'power' | 'meter';
    priceDefinition?: string | null;
    costType?: string | null;
    basicRate?: boolean;
    resetDetection?: boolean;
    outputId: string;
    cumulative?: number | null;
    valueAtDeviceReset?: number | null;
    pendingMeterSwap?: boolean;
    lastValue?: ioBroker.StateValue | null;
    lastValueTs?: number | null;
    lastUpdate?: number | null;
    values: Record<string, SourceValues>;
    settings: Record<string, any>;
    diagnostics: Finding[];
    status?: 'ok' | 'warning' | 'error' | 'disabled';
}

export interface Problem {
    id: string;
    source: string;
    name: string;
    code: string;
    severity: 'error' | 'warning';
    fix?: { command: string; message?: Record<string, any> };
    [key: string]: any;
}

export interface PriceDefinition {
    cat: string;
    costType: string;
    unitType: string;
    unitPrice: number;
    basicPrice: number;
    priceSource: string;
}

export interface Overview {
    ok: boolean;
    sources: Source[];
    problems: Problem[];
    passed: string[];
    checkedAt: number;
    priceDefinitions: PriceDefinition[];
    units: string[];
    currency?: string | null;
}

export interface ActionResult {
    ok?: boolean;
    error?: string;
    message?: string;
    errors?: Record<string, any>;
    [key: string]: any;
}

export interface Api {
    socket: AdminConnection;
    instance: number;
    adapterName: string;
    themeType: string;
    /** MUI theme of the admin, needed by the object selection dialog */
    theme: any;
}

/**
 * Name of the adapter instance, e.g. sourceanalytix.0
 *
 * @param api
 */
export function instanceId(api: Api): string {
    return `${api.adapterName}.${api.instance}`;
}

/**
 * Send an instant action to the running adapter
 *
 * @param api
 * @param command
 * @param message
 */
export async function send<T = ActionResult>(api: Api, command: string, message: Record<string, any> = {}): Promise<T> {
    return api.socket.sendTo(instanceId(api), command, message);
}

/**
 * Translate a key of src/i18n with %s placeholders
 *
 * @param key
 * @param args
 */
export function t(key: string, ...args: (string | number)[]): string {
    return I18n.t(key, ...args);
}

export function locale(): string {
    const lang = I18n.getLanguage();
    return lang === 'en' ? 'en-GB' : lang;
}

/**
 * Format a number in the language of the admin, e.g. 48.213,4
 *
 * @param value
 * @param decimals
 */
export function nf(value: number | null | undefined, decimals = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '–';
    }
    return new Intl.NumberFormat(locale(), {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    }).format(value);
}

/**
 * Format money in the system currency
 *
 * @param value
 * @param currency
 */
export function money(value: number | null | undefined, currency?: string | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '–';
    }
    return `${new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency || '€'}`;
}

/**
 * Format a date as DD.MM.YYYY
 *
 * @param ts
 */
export function df(ts: number | Date): string {
    return new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * "Updated 3 min ago"
 *
 * @param ts
 */
export function ago(ts: number | null | undefined): string {
    if (!ts) {
        return t('sa_never');
    }
    const minutes = Math.round((Date.now() - ts) / 60000);
    if (minutes < 1) {
        return t('sa_justNow');
    }
    if (minutes < 60) {
        return t('sa_minutesAgo', minutes);
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
        return t('sa_hoursAgo', hours);
    }
    return t('sa_daysAgo', Math.round(hours / 24));
}

/**
 * Parse a number with comma or dot as in the design:
 * "1.283,2" → 1283.2, "1283.2" → 1283.2, "1.283" → 1283 (thousands separator), "" → null
 *
 * @param input
 */
export function parseNum(input: string | number | null | undefined): number | null {
    if (input === null || input === undefined) {
        return null;
    }
    if (typeof input === 'number') {
        return Number.isFinite(input) ? input : null;
    }
    let text = input.trim().replace(/\s/g, '');
    if (!text) {
        return null;
    }
    if (text.includes(',') && text.includes('.')) {
        // Separator that comes last is the decimal separator
        text =
            text.lastIndexOf(',') > text.lastIndexOf('.')
                ? text.replace(/\./g, '').replace(',', '.')
                : text.replace(/,/g, '');
    } else if (text.includes(',')) {
        // A single comma or dot is the decimal mark, like in the adapter: 1.283 is 1,283
        text = text.replace(',', '.');
    }
    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
}

export const startFields = ['start_day', 'start_week', 'start_month', 'start_quarter', 'start_year'] as const;
export type StartField = (typeof startFields)[number];

/**
 * Start of the running periods, the same as lib/source-overview.js
 *
 * @param date
 */
export function periodStarts(date: Date): Record<StartField, Date> {
    const isoWeekday = date.getDay() || 7;
    return {
        start_day: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        start_week: new Date(date.getFullYear(), date.getMonth(), date.getDate() - isoWeekday + 1),
        start_month: new Date(date.getFullYear(), date.getMonth(), 1),
        start_quarter: new Date(date.getFullYear(), date.getMonth() - (date.getMonth() % 3), 1),
        start_year: new Date(date.getFullYear(), 0, 1),
    };
}

/**
 * Check start values like the adapter (lib/source-overview.js checkStartValues) and return texts
 *
 * @param values
 * @param cumulative
 * @param unit
 */
export function startValueErrors(
    values: Partial<Record<StartField, string>>,
    cumulative: number | null,
    unit: string,
): Partial<Record<StartField, string>> {
    const errors: Partial<Record<StartField, string>> = {};
    const starts = periodStarts(new Date());
    const parsed: Partial<Record<StartField, number>> = {};
    for (const field of startFields) {
        const value = parseNum(values[field]);
        if (value === null) {
            continue;
        }
        if (Number.isNaN(value)) {
            errors[field] = t('sa_errNumber');
            continue;
        }
        if (value < 0) {
            errors[field] = t('sa_errNegative');
            continue;
        }
        parsed[field] = value;
        if (cumulative !== null && value > cumulative) {
            errors[field] =
                value / 1000 <= cumulative
                    ? t('sa_errLooksLikeWh', nf(value / 1000, 3), unit)
                    : t('sa_errAboveTotal', nf(cumulative, 3), unit);
        }
    }
    const ordered = (Object.keys(parsed) as StartField[]).sort(
        (a, b) => starts[a].getTime() - starts[b].getTime() || startFields.indexOf(b) - startFields.indexOf(a),
    );
    ordered.forEach((field, index) => {
        if (errors[field]) {
            return;
        }
        for (const later of ordered.slice(index + 1)) {
            if (starts[later].getTime() > starts[field].getTime() && parsed[field]! > parsed[later]!) {
                errors[field] = t('sa_errOrder', t(`sa_period_${later}`), nf(parsed[later], 3));
                break;
            }
        }
    });
    return errors;
}

/**
 * Material icon of a source
 *
 * @param source
 */
export function sourceIcon(source: Pick<Source, 'kind' | 'calcUnit' | 'costType' | 'name'>): string {
    const name = (source.name || '').toLowerCase();
    if (source.costType === 'earnings') {
        return 'solar_power';
    }
    if (source.calcUnit === 'm³' && /gas/.test(name)) {
        return 'local_fire_department';
    }
    if (source.calcUnit === 'm³' || source.calcUnit === 'l') {
        return 'water_drop';
    }
    if (/wärmepumpe|heat/.test(name)) {
        return 'heat_pump';
    }
    if (/wasch|trockner|wash|dry/.test(name)) {
        return 'local_laundry_service';
    }
    return 'bolt';
}

/**
 * Short status text of a source for the card footer
 *
 * @param source
 * @param problems
 */
export function statusText(source: Source, problems: Problem[]): string {
    const own = problems.filter(problem => problem.source === source.id);
    if (!own.length) {
        return '';
    }
    return t(`sa_problem_${own[0].code}`);
}

/**
 * Technical ID from a display name (design: ^[a-z0-9_]+$, umlauts replaced)
 *
 * @param name
 */
export function slug(name: string): string {
    return name
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}
