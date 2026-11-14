import React, { useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    LinearProgress,
    MenuItem,
    TextField,
    Typography,
} from '@mui/material';
import { Bolt } from '@mui/icons-material';

import { df, nf, parseNum, send, t, type ActionResult, type Api, type Source } from './api';
import { tabular } from './ui';

export type DialogType = 'align' | 'swap' | 'recalc' | 'delete' | 'unit';

interface DialogProps {
    api: Api;
    source: Source;
    alive: boolean;
    units?: string[];
    /** Recalculate all sources of this price definition instead of one source */
    priceDefinition?: string;
    initialDate?: string;
    onClose: (doneText?: string) => void;
}

function ExpertNote(props: { children: React.ReactNode }): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <Box sx={{ mt: 2 }}>
            <Button
                size="small"
                onClick={() => setOpen(!open)}
            >
                {t('sa_forExperts')}
            </Button>
            <Collapse in={open}>
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1 }}
                >
                    {props.children}
                </Typography>
            </Collapse>
        </Box>
    );
}

function BoltButton(props: {
    label: string;
    disabled?: boolean;
    color?: 'primary' | 'error';
    onClick: () => void;
}): React.JSX.Element {
    return (
        <Button
            variant="contained"
            color={props.color || 'primary'}
            startIcon={<Bolt />}
            disabled={props.disabled}
            onClick={props.onClick}
        >
            {props.label}
        </Button>
    );
}

function useAction(api: Api): {
    busy: boolean;
    error: string;
    run: (command: string, message: Record<string, any>) => Promise<ActionResult | null>;
} {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const run = async (command: string, message: Record<string, any>): Promise<ActionResult | null> => {
        setBusy(true);
        setError('');
        try {
            const result = await send(api, command, message);
            if (result.error) {
                setError(
                    t(`sa_err_${result.error}`) === `sa_err_${result.error}`
                        ? result.message || result.error
                        : t(`sa_err_${result.error}`),
                );
                return null;
            }
            return result;
        } catch (e) {
            setError(String(e));
            return null;
        } finally {
            setBusy(false);
        }
    };
    return { busy, error, run };
}

/**
 * Dialog "Align meter reading" (#640)
 *
 * @param props
 */
export function AlignDialog(props: DialogProps): React.JSX.Element {
    const { source } = props;
    const unit = source.calcUnit || '';
    const [value, setValue] = useState('');
    const [preview, setPreview] = useState<ActionResult | null>(null);
    const action = useAction(props.api);
    const parsed = parseNum(value);
    const invalid = value !== '' && (parsed === null || Number.isNaN(parsed) || parsed < 0);

    useEffect(() => {
        if (parsed === null || Number.isNaN(parsed) || parsed < 0) {
            setPreview(null);
            return;
        }
        const timer = setTimeout(() => {
            void send(props.api, 'setCumulative', { source: source.id, value: parsed, dryRun: true }).then(result =>
                setPreview(result.ok ? result : null),
            );
        }, 300);
        return () => clearTimeout(timer);
    }, [value]);

    const today = source.values['01_currentDay']?.quantity;
    return (
        <Dialog
            open
            onClose={() => props.onClose()}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('sa_alignTitle', source.name)}</DialogTitle>
            <DialogContent>
                <Typography sx={{ mb: 2 }}>{t('sa_alignQuestion')}</Typography>
                <TextField
                    autoFocus
                    fullWidth
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    error={invalid}
                    helperText={invalid ? t('sa_errNumber') : t('sa_alignHelp', nf(source.cumulative, 3), unit)}
                    slotProps={{
                        htmlInput: { inputMode: 'decimal', style: { fontSize: 22 } },
                        input: { endAdornment: unit },
                    }}
                />
                {preview ? (
                    <Alert
                        severity="info"
                        sx={{ mt: 2, ...tabular }}
                    >
                        {t('sa_alignPreview1', nf(preview.previousCumulative, 3), nf(preview.cumulative, 3), unit)}
                        <br />
                        {t('sa_alignPreview2', nf(today, 3), unit)}
                    </Alert>
                ) : null}
                {action.error ? (
                    <Alert
                        severity="error"
                        sx={{ mt: 2 }}
                    >
                        {action.error}
                    </Alert>
                ) : null}
                <ExpertNote>
                    {t(
                        'sa_alignExpert',
                        String(source.valueAtDeviceReset ?? 0),
                        preview ? String(preview.valueAtDeviceReset ?? '–') : '–',
                    )}
                </ExpertNote>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => props.onClose()}>{t('sa_cancel')}</Button>
                <BoltButton
                    label={t('sa_alignButton')}
                    disabled={!props.alive || !preview || action.busy}
                    onClick={async () => {
                        const result = await action.run('setCumulative', { source: source.id, value: parsed });
                        if (result) {
                            props.onClose(t('sa_alignDone', nf(result.cumulative, 3), unit));
                        }
                    }}
                />
            </DialogActions>
        </Dialog>
    );
}

/**
 * Dialog "Meter swapped" (#1269)
 *
 * @param props
 */
export function SwapDialog(props: DialogProps): React.JSX.Element {
    const { source } = props;
    const unit = source.calcUnit || '';
    const total = source.cumulative || 0;
    const [oldEnd, setOldEnd] = useState(nf(total, 3));
    const [newStart, setNewStart] = useState('0');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const action = useAction(props.api);
    const end = parseNum(oldEnd);
    const start = parseNum(newStart);
    const badEnd = end === null || Number.isNaN(end);
    const low = !badEnd && end < total - 1e-9;
    const badStart = start !== null && (Number.isNaN(start) || start < 0);
    return (
        <Dialog
            open
            onClose={() => props.onClose()}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('sa_swapTitle', source.name)}</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
                    <TextField
                        label={t('sa_swapOldEnd', unit)}
                        value={oldEnd}
                        onChange={e => setOldEnd(e.target.value)}
                        error={badEnd || low}
                        helperText={
                            badEnd ? t('sa_swapOldEndMissing') : low ? t('sa_swapOldEndLow', nf(total, 3), unit) : ''
                        }
                        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    <TextField
                        label={t('sa_swapNewStart', unit)}
                        value={newStart}
                        onChange={e => setNewStart(e.target.value)}
                        error={badStart}
                        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    <TextField
                        label={t('sa_swapDate')}
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }}
                    />
                </Box>
                {!badEnd && !low && !badStart ? (
                    <Alert
                        severity="info"
                        sx={{ mt: 2, ...tabular }}
                    >
                        {t('sa_swapPreview1', nf(total, 3), nf(end - total, 3), nf(end, 3), unit)}
                        <br />
                        {t('sa_swapPreview2', nf(start || 0, 3), unit)}
                    </Alert>
                ) : null}
                {action.error ? (
                    <Alert
                        severity="error"
                        sx={{ mt: 2 }}
                    >
                        {action.error}
                    </Alert>
                ) : null}
                <ExpertNote>{t('sa_swapExpert')}</ExpertNote>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => props.onClose()}>{t('sa_cancel')}</Button>
                <BoltButton
                    label={t('sa_swapButton')}
                    disabled={!props.alive || badEnd || low || badStart || action.busy}
                    onClick={async () => {
                        const result = await action.run('meterSwap', {
                            source: source.id,
                            oldEnd: end,
                            newStart: start || 0,
                            date,
                        });
                        if (result) {
                            props.onClose(t('sa_swapDone', nf(result.cumulative, 3), unit));
                        }
                    }}
                />
            </DialogActions>
        </Dialog>
    );
}

/**
 * Dialog "Recalculate costs from date" (#947)
 *
 * @param props
 */
export function RecalcDialog(props: DialogProps): React.JSX.Element {
    const { source, api } = props;
    const [date, setDate] = useState(props.initialDate || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
    const [preview, setPreview] = useState<ActionResult | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number; running: boolean } | null>(null);
    const action = useAction(api);
    const from = new Date(`${date}T00:00:00`).getTime();
    const future = !Number.isFinite(from) || from > Date.now();
    const target = props.priceDefinition ? { priceDefinition: props.priceDefinition } : { source: source.id };

    useEffect(() => {
        if (future) {
            setPreview(null);
            return;
        }
        void send(api, 'recalcCosts', { ...target, from, dryRun: true }).then(result =>
            setPreview(result.ok ? result : null),
        );
    }, [date]);

    useEffect(() => {
        const id = `${api.adapterName}.${api.instance}.info.costRecalculation`;
        const handler = (_id: string, state: ioBroker.State | null | undefined): void => {
            if (!state?.val) {
                return;
            }
            try {
                const value = JSON.parse(String(state.val));
                setProgress({ done: value.done, total: value.total, running: value.running });
            } catch {
                // ignore invalid progress
            }
        };
        void api.socket.subscribeState(id, handler);
        return () => api.socket.unsubscribeState(id, handler);
    }, []);

    const kinds = preview?.periods ? Object.entries(preview.periods) : [];
    const finished = progress && !progress.running && progress.total > 0 && progress.done >= progress.total;
    return (
        <Dialog
            open
            onClose={() => props.onClose()}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>
                {props.priceDefinition
                    ? t('sa_recalcTitleAll', props.priceDefinition)
                    : t('sa_recalcTitle', source.name)}
            </DialogTitle>
            <DialogContent>
                <TextField
                    sx={{ mt: 1 }}
                    label={t('sa_recalcFrom')}
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    error={future}
                    helperText={future ? t('sa_recalcFuture') : df(from)}
                    slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { max: new Date().toISOString().slice(0, 10) },
                    }}
                />
                {preview ? (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="body2">{t('sa_recalcAffected', preview.total)}</Typography>
                        <ul style={{ margin: '4px 0 0 0' }}>
                            {kinds.map(([kind, count]) => (
                                <li key={kind}>
                                    <Typography variant="body2">{`${t(`sa_kind_${kind}`)}: ${String(count)}`}</Typography>
                                </li>
                            ))}
                        </ul>
                    </Box>
                ) : null}
                <Alert
                    severity="info"
                    sx={{ mt: 2 }}
                >
                    {t('sa_recalcNote')}
                </Alert>
                {progress && (action.busy || finished) ? (
                    <Box sx={{ mt: 2 }}>
                        <LinearProgress
                            variant="determinate"
                            value={progress.total ? (100 * progress.done) / progress.total : 0}
                        />
                        <Typography
                            variant="body2"
                            sx={{ mt: 0.5 }}
                        >
                            {finished ? t('sa_recalcFinished') : t('sa_recalcProgress', progress.done, progress.total)}
                        </Typography>
                    </Box>
                ) : null}
                {action.error ? (
                    <Alert
                        severity="error"
                        sx={{ mt: 2 }}
                    >
                        {action.error}
                    </Alert>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => props.onClose()}>{t('sa_cancel')}</Button>
                <BoltButton
                    label={t('sa_recalcButton')}
                    disabled={!props.alive || future || !preview || !preview.total || action.busy}
                    onClick={async () => {
                        const result = await action.run('recalcCosts', { ...target, from });
                        if (result) {
                            props.onClose(t('sa_recalcDone', result.total));
                        }
                    }}
                />
            </DialogActions>
        </Dialog>
    );
}

/**
 * Dialog "Delete data" (#1265)
 *
 * @param props
 */
export function DeleteDialog(props: DialogProps): React.JSX.Element {
    const { source, api } = props;
    const [preview, setPreview] = useState<ActionResult | null>(null);
    const [confirm, setConfirm] = useState('');
    const action = useAction(api);
    const message = source.orphan ? { outputId: source.outputId } : { source: source.id };

    useEffect(() => {
        void send(api, 'deleteSourceData', { ...message, dryRun: true }).then(result =>
            setPreview(result.ok ? result : null),
        );
    }, []);

    return (
        <Dialog
            open
            onClose={() => props.onClose()}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle sx={{ color: 'error.main' }}>{t('sa_deleteTitle', source.name)}</DialogTitle>
            <DialogContent>
                <Typography>{t('sa_deleteIntro')}</Typography>
                {preview ? (
                    <ul>
                        <li>
                            {t(
                                'sa_deleteStates',
                                preview.states,
                                `${api.adapterName}.${api.instance}.${preview.outputId}`,
                            )}
                        </li>
                        {preview.years?.length ? <li>{t('sa_deleteYears', preview.years.join(', '))}</li> : null}
                        {preview.cumulative !== null && preview.cumulative !== undefined ? (
                            <li>{t('sa_deleteTotal', nf(Number(preview.cumulative), 3), source.calcUnit || '')}</li>
                        ) : null}
                        {!source.orphan ? <li>{t('sa_deleteSettings')}</li> : null}
                    </ul>
                ) : (
                    <LinearProgress sx={{ my: 2 }} />
                )}
                {!source.orphan ? (
                    <Alert
                        severity="info"
                        sx={{ mb: 2 }}
                    >
                        {t('sa_deleteHint')}
                    </Alert>
                ) : null}
                <TextField
                    fullWidth
                    label={t('sa_deleteConfirm', source.name)}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                />
                {action.error ? (
                    <Alert
                        severity="error"
                        sx={{ mt: 2 }}
                    >
                        {action.error}
                    </Alert>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => props.onClose()}>{t('sa_cancel')}</Button>
                <BoltButton
                    color="error"
                    label={t('sa_deleteButton')}
                    disabled={!props.alive || !preview || confirm !== source.name || action.busy}
                    onClick={async () => {
                        const result = await action.run('deleteSourceData', message);
                        if (result) {
                            props.onClose(t('sa_deleteDone', source.name));
                        }
                    }}
                />
            </DialogActions>
        </Dialog>
    );
}

/**
 * Dialog "Fix unit" from the problems tab
 *
 * @param props
 */
export function UnitDialog(props: DialogProps): React.JSX.Element {
    const { source, api } = props;
    const [unit, setUnit] = useState(source.settings.selectedUnit || '');
    const action = useAction(api);
    const units = (props.units || []).filter(entry => entry !== 'Detect automatically');
    return (
        <Dialog
            open
            onClose={() => props.onClose()}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('sa_unitTitle', source.name)}</DialogTitle>
            <DialogContent>
                <Typography sx={{ mb: 2 }}>{t('sa_unitIntro', source.sourceUnit || t('sa_none'))}</Typography>
                <TextField
                    select
                    fullWidth
                    label={t('sa_unit')}
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                >
                    {units.map(entry => (
                        <MenuItem
                            key={entry}
                            value={entry}
                        >
                            {entry}
                        </MenuItem>
                    ))}
                </TextField>
                {action.error ? (
                    <Alert
                        severity="error"
                        sx={{ mt: 2 }}
                    >
                        {action.error}
                    </Alert>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => props.onClose()}>{t('sa_cancel')}</Button>
                <BoltButton
                    label={t('sa_apply')}
                    disabled={!props.alive || !unit || action.busy}
                    onClick={async () => {
                        const result = await action.run('saveSource', {
                            source: source.id,
                            settings: { selectedUnit: unit },
                        });
                        if (result) {
                            props.onClose(t('sa_unitDone', unit));
                        }
                    }}
                />
            </DialogActions>
        </Dialog>
    );
}

export function ActionDialog(props: DialogProps & { type: DialogType }): React.JSX.Element {
    switch (props.type) {
        case 'align':
            return <AlignDialog {...props} />;
        case 'swap':
            return <SwapDialog {...props} />;
        case 'recalc':
            return <RecalcDialog {...props} />;
        case 'delete':
            return <DeleteDialog {...props} />;
        default:
            return <UnitDialog {...props} />;
    }
}
