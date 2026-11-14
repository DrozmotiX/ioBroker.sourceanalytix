import React, { useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    Collapse,
    Divider,
    FormControlLabel,
    MenuItem,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import {
    ArrowBack,
    Bolt,
    CalendarMonth,
    Delete,
    History,
    Pause,
    PlayArrow,
    SwapHoriz,
    Tune,
    Euro,
} from '@mui/icons-material';

import {
    ago,
    money,
    nf,
    parseNum,
    send,
    sourceIcon,
    statusText,
    startFields,
    startValueErrors,
    t,
    type Api,
    type Overview,
    type Problem,
    type Source,
} from './api';
import { ActionDialog, type DialogType } from './Dialogs';
import { Card, SectionTitle, SourceAvatar, StatusChip, tabular } from './ui';

interface SourceDetailProps {
    api: Api;
    alive: boolean;
    source: Source;
    overview: Overview;
    onBack: () => void;
    onChanged: (snack?: string) => void;
}

const periods: [string, boolean][] = [
    ['01_currentDay', false],
    ['01_previousDay', true],
    ['02_currentWeek', false],
    ['02_previousWeek', true],
    ['03_currentMonth', false],
    ['03_previousMonth', true],
    ['04_currentQuarter', false],
    ['04_previousQuarter', true],
    ['05_currentYear', false],
    ['05_previousYear', true],
];

// Settings that are entered as text and stored as numbers
const numericSettings = [
    'threshold',
    'decimalsQuantity',
    'decimalsCosts',
    'maxPowerGap',
    'pulsesPerUnit',
    ...startFields,
];

const settingFlags = [
    'deviceResetLogicEnabled',
    'basicRate',
    'consumption',
    'costs',
    'meter_values',
    'ignoreNegativeValues',
] as const;

function MetaItem(props: { label: string; value: React.ReactNode }): React.JSX.Element {
    return (
        <Box>
            <Typography
                variant="caption"
                color="text.secondary"
            >
                {props.label}
            </Typography>
            <Typography sx={{ fontSize: 14, ...tabular }}>{props.value}</Typography>
        </Box>
    );
}

function ActionRow(props: {
    icon: React.ReactNode;
    title: string;
    text: string;
    button: string;
    disabled?: boolean;
    danger?: boolean;
    planned?: boolean;
    onClick?: () => void;
}): React.JSX.Element {
    return (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 1.5 }}>
            <Box sx={{ color: props.danger ? 'error.main' : 'text.secondary', display: 'flex' }}>{props.icon}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    component="div"
                    sx={{ fontSize: 14, fontWeight: 500 }}
                >
                    {props.title}
                    {props.planned ? (
                        <Chip
                            size="small"
                            label={t('sa_planned')}
                            sx={{ ml: 1, height: 20 }}
                        />
                    ) : null}
                </Typography>
                <Typography
                    variant="body2"
                    color="text.secondary"
                >
                    {props.text}
                </Typography>
            </Box>
            <Button
                variant="outlined"
                size="small"
                color={props.danger ? 'error' : 'primary'}
                startIcon={<Bolt />}
                disabled={props.disabled}
                onClick={props.onClick}
                sx={{ flex: '0 0 auto' }}
            >
                {props.button}
            </Button>
        </Box>
    );
}

export default function SourceDetail(props: SourceDetailProps): React.JSX.Element {
    const { source, api, alive, overview } = props;
    const unit = source.calcUnit || source.unit || '';
    const earnings = source.costType === 'earnings';
    const [dialog, setDialog] = useState<DialogType | null>(null);
    const [expert, setExpert] = useState(false);
    const [settings, setSettings] = useState<Record<string, any>>(() => ({ ...source.settings }));
    const [errors, setErrors] = useState<Record<string, any>>({});
    const [busy, setBusy] = useState(false);
    const changed = useMemo(
        () => Object.keys(settings).some(key => settings[key] !== source.settings[key]),
        [settings, source.settings],
    );
    const ownProblems: Problem[] = overview.problems.filter(problem => problem.source === source.id);
    const prices = overview.priceDefinitions;
    const set = (key: string, value: unknown): void => setSettings({ ...settings, [key]: value });
    const isChanged = (key: string): boolean => settings[key] !== source.settings[key];
    const sourceUnit = source.sourceUnit || source.unit || '';
    const pulseSource = ['piece', 'piece/min'].includes(sourceUnit) && unit !== 'piece';
    const powerSource = source.kind === 'power' && !settings.incrementValues;
    // Start values are checked like in the wizard, only changed fields block saving
    const startErrors = useMemo(() => {
        const values: Record<string, string> = {};
        for (const field of startFields) {
            values[field] = settings[field] === undefined || settings[field] === null ? '' : String(settings[field]);
        }
        const all = startValueErrors(values, typeof source.cumulative === 'number' ? source.cumulative : null, unit);
        return Object.fromEntries(Object.entries(all).filter(([field]) => isChanged(field)));
    }, [settings, source.cumulative, unit]);
    const numberError = (key: string): boolean =>
        isChanged(key) && settings[key] !== '' && settings[key] !== null && settings[key] !== undefined
            ? Number.isNaN(parseNum(settings[key]))
            : false;

    const apply = async (): Promise<void> => {
        const update: Record<string, any> = {};
        for (const key of Object.keys(settings)) {
            if (settings[key] !== source.settings[key]) {
                const value = settings[key];
                if (numericSettings.includes(key) && typeof value === 'string') {
                    // Numbers are stored as numbers, an empty field removes the value
                    const parsed = parseNum(value);
                    update[key] = parsed === null ? '' : parsed;
                } else {
                    update[key] = value;
                }
            }
        }
        setBusy(true);
        const result = await send(api, 'saveSource', { source: source.id, settings: update });
        setBusy(false);
        if (result.error) {
            setErrors(result.errors || { _: result.message });
            return;
        }
        setErrors({});
        props.onChanged(t('sa_settingsApplied'));
    };

    const toggleEnabled = async (): Promise<void> => {
        const result = await send(api, 'setSourceEnabled', { source: source.id, enabled: !source.enabled });
        if (!result.error) {
            props.onChanged(source.enabled ? t('sa_deactivated', source.name) : t('sa_activated', source.name));
        }
    };

    const recoverPeriods = async (): Promise<void> => {
        const result = await send(api, 'recoverPeriods', { source: source.id });
        if (!result.error) {
            props.onChanged(t('sa_recovered', source.name));
        }
    };

    return (
        <Box>
            <Button
                startIcon={<ArrowBack />}
                onClick={props.onBack}
                sx={{ mb: 1 }}
            >
                {t('sa_backToOverview')}
            </Button>
            <Card sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <SourceAvatar
                        icon={sourceIcon(source)}
                        size={48}
                    />
                    <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Typography sx={{ fontSize: 22, fontWeight: 400 }}>{source.name}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                            <StatusChip status={source.status} />
                            <Typography
                                variant="body2"
                                color="text.secondary"
                            >
                                {statusText(source, overview.problems)}
                            </Typography>
                        </Box>
                    </Box>
                </Box>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: 2,
                        mt: 2,
                    }}
                >
                    <MetaItem
                        label={t('sa_datapoint')}
                        value={source.id}
                    />
                    <MetaItem
                        label={t('sa_kind')}
                        value={
                            source.kind === 'power'
                                ? t('sa_kindPowerUnit', source.unit || 'W', unit)
                                : t('sa_kindMeterUnit', unit)
                        }
                    />
                    <MetaItem
                        label={t('sa_total')}
                        value={`${nf(source.cumulative, 3)} ${unit}`}
                    />
                    <MetaItem
                        label={t('sa_price')}
                        value={source.priceDefinition || '–'}
                    />
                    <MetaItem
                        label={t('sa_lastUpdate')}
                        value={ago(source.lastUpdate)}
                    />
                </Box>
                <Button
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() => setExpert(!expert)}
                >
                    {t('sa_forExperts')}
                </Button>
                <Collapse in={expert}>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                    >
                        {t('sa_objectId')}: {source.id}
                        <br />
                        {t('sa_outputId')}: {`${api.adapterName}.${api.instance}.${source.outputId}`}
                        <br />
                        valueAtDeviceReset: {String(source.valueAtDeviceReset ?? '–')}
                    </Typography>
                </Collapse>
            </Card>

            {ownProblems.map(problem => (
                <Alert
                    key={problem.id}
                    severity={problem.severity === 'error' ? 'error' : 'warning'}
                    sx={{ mb: 2 }}
                >
                    {t(`sa_problem_${problem.code}`)} – {t(`sa_suggest_${problem.code}`)}
                </Alert>
            ))}

            <Box
                sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: '1fr', md: '1.6fr minmax(300px, 1fr)' },
                    alignItems: 'start',
                }}
            >
                <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <Card>
                        <SectionTitle>{t('sa_values')}</SectionTitle>
                        <Box sx={{ overflowX: 'auto' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{t('sa_period')}</TableCell>
                                        <TableCell align="right">
                                            {earnings ? t('sa_delivery') : t('sa_consumption')}
                                        </TableCell>
                                        <TableCell align="right">
                                            {earnings ? t('sa_earnings') : t('sa_costs')}
                                        </TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {periods.map(([period, previous]) => (
                                        <TableRow key={period}>
                                            <TableCell
                                                sx={{
                                                    pl: previous ? 4 : undefined,
                                                    color: previous ? 'text.secondary' : undefined,
                                                }}
                                            >
                                                {t(`sa_p_${period}`)}
                                            </TableCell>
                                            <TableCell
                                                align="right"
                                                sx={tabular}
                                            >
                                                {`${nf(source.values[period]?.quantity, 3)} ${unit}`}
                                            </TableCell>
                                            <TableCell
                                                align="right"
                                                sx={tabular}
                                            >
                                                {money(source.values[period]?.money, overview.currency)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                    </Card>

                    <Card>
                        <SectionTitle>{t('sa_settings')}</SectionTitle>
                        <Box
                            sx={{
                                display: 'grid',
                                gap: 2,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            }}
                        >
                            <TextField
                                label={t('sa_name')}
                                value={settings.alias || ''}
                                onChange={e => set('alias', e.target.value)}
                            />
                            <TextField
                                select
                                label={t('sa_unit')}
                                value={settings.selectedUnit || 'Detect automatically'}
                                error={!!errors.selectedUnit}
                                helperText={errors.selectedUnit ? t(`sa_err_${errors.selectedUnit}`) : ''}
                                onChange={e => set('selectedUnit', e.target.value)}
                            >
                                {overview.units.concat(['Detect automatically']).map(entry => (
                                    <MenuItem
                                        key={entry}
                                        value={entry}
                                    >
                                        {entry === 'Detect automatically' ? t('sa_detectUnit') : entry}
                                    </MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                select
                                label={t('sa_priceDefinition')}
                                value={settings.selectedPrice || ''}
                                error={!!errors.selectedPrice}
                                helperText={errors.selectedPrice ? t(`sa_err_${errors.selectedPrice}`) : ''}
                                onChange={e => set('selectedPrice', e.target.value)}
                            >
                                {prices.map(price => (
                                    <MenuItem
                                        key={price.cat}
                                        value={price.cat}
                                    >
                                        {`${price.cat} (${price.unitType})`}
                                    </MenuItem>
                                ))}
                            </TextField>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, mt: 1 }}>
                            {settingFlags.map(flag => (
                                <FormControlLabel
                                    key={flag}
                                    control={
                                        <Checkbox
                                            checked={
                                                flag === 'deviceResetLogicEnabled'
                                                    ? settings[flag] !== false
                                                    : !!settings[flag]
                                            }
                                            onChange={e => set(flag, e.target.checked)}
                                        />
                                    }
                                    label={t(`sa_flag_${flag}`)}
                                />
                            ))}
                            {powerSource ? (
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={!!settings.averagePowerValues}
                                            onChange={e => set('averagePowerValues', e.target.checked)}
                                        />
                                    }
                                    label={t('sa_flag_averagePowerValues')}
                                />
                            ) : null}
                        </Box>
                        {powerSource || pulseSource ? (
                            <Box
                                sx={{
                                    display: 'grid',
                                    gap: 2,
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                    mt: 1,
                                }}
                            >
                                {powerSource ? (
                                    <TextField
                                        label={t('sa_maxPowerGap')}
                                        value={settings.maxPowerGap ?? ''}
                                        error={numberError('maxPowerGap')}
                                        helperText={
                                            numberError('maxPowerGap') ? t('sa_errNumber') : t('sa_maxPowerGapHelp')
                                        }
                                        onChange={e => set('maxPowerGap', e.target.value)}
                                        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                                    />
                                ) : null}
                                {pulseSource ? (
                                    <TextField
                                        label={t('sa_pulsesPerUnit', unit)}
                                        value={settings.pulsesPerUnit ?? ''}
                                        error={numberError('pulsesPerUnit')}
                                        helperText={
                                            numberError('pulsesPerUnit') ? t('sa_errNumber') : t('sa_pulsesPerUnitHelp')
                                        }
                                        onChange={e => set('pulsesPerUnit', e.target.value)}
                                        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                                    />
                                ) : null}
                            </Box>
                        ) : null}
                        <SectionTitle>{t('sa_startValues')}</SectionTitle>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mb: 1 }}
                        >
                            {t('sa_startValuesDetail', unit)}
                        </Typography>
                        <Box
                            sx={{
                                display: 'grid',
                                gap: 2,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                            }}
                        >
                            {startFields.map(field => (
                                <TextField
                                    key={field}
                                    label={t(`sa_period_${field}`)}
                                    value={settings[field] ?? ''}
                                    error={!!startErrors[field] || !!errors[field]}
                                    helperText={startErrors[field] || (errors[field] ? t('sa_settingsInvalid') : '')}
                                    onChange={e => set(field, e.target.value)}
                                    slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: unit } }}
                                />
                            ))}
                        </Box>
                        <Button
                            size="small"
                            onClick={() => setExpert(!expert)}
                        >
                            {t('sa_forExperts')}
                        </Button>
                        <Collapse in={expert}>
                            <Box
                                sx={{
                                    display: 'grid',
                                    gap: 2,
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                    mt: 1,
                                }}
                            >
                                <TextField
                                    label={t('sa_threshold', unit)}
                                    value={settings.threshold ?? 1}
                                    onChange={e => set('threshold', e.target.value)}
                                />
                                <TextField
                                    label={t('sa_decimalsQuantity')}
                                    value={settings.decimalsQuantity ?? ''}
                                    onChange={e => set('decimalsQuantity', e.target.value)}
                                />
                                <TextField
                                    label={t('sa_decimalsCosts')}
                                    value={settings.decimalsCosts ?? ''}
                                    onChange={e => set('decimalsCosts', e.target.value)}
                                />
                                <TextField
                                    label={t('sa_outputId')}
                                    value={settings.outputId ?? source.outputId}
                                    error={!!errors.outputId}
                                    helperText={
                                        errors.outputId === 'used'
                                            ? t('sa_errOutputIdUsed')
                                            : errors.outputId
                                              ? t('sa_errOutputId')
                                              : isChanged('outputId')
                                                ? t('sa_outputIdChangeHint')
                                                : ''
                                    }
                                    onChange={e => set('outputId', e.target.value.trim())}
                                />
                            </Box>
                            {source.kind !== 'power' || settings.incrementValues ? (
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={!!settings.incrementValues}
                                            onChange={e => set('incrementValues', e.target.checked)}
                                        />
                                    }
                                    label={t('sa_flag_incrementValues')}
                                />
                            ) : null}
                        </Collapse>
                        {Object.keys(errors).length ? (
                            <Alert
                                severity="error"
                                sx={{ mt: 2 }}
                            >
                                {errors._ || t('sa_settingsInvalid')}
                            </Alert>
                        ) : null}
                        <Divider sx={{ my: 2 }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ flex: 1 }}
                            >
                                {t('sa_appliesInstantly')}
                            </Typography>
                            <Button
                                variant="contained"
                                startIcon={<Bolt />}
                                disabled={!alive || !changed || busy || Object.keys(startErrors).length > 0}
                                onClick={() => void apply()}
                            >
                                {t('sa_apply')}
                            </Button>
                        </Box>
                    </Card>
                </Box>

                <Card>
                    <SectionTitle>{t('sa_actions')}</SectionTitle>
                    <ActionRow
                        icon={<Tune />}
                        title={t('sa_actionAlign')}
                        text={t('sa_actionAlignText')}
                        button={t('sa_actionAlignButton')}
                        disabled={!alive || !source.active}
                        onClick={() => setDialog('align')}
                    />
                    <Divider />
                    <ActionRow
                        icon={<SwapHoriz />}
                        title={t('sa_actionSwap')}
                        text={t('sa_actionSwapText')}
                        button={t('sa_actionSwapButton')}
                        disabled={!alive || !source.active || source.kind === 'power'}
                        onClick={() => setDialog('swap')}
                    />
                    <Divider />
                    <ActionRow
                        icon={<Euro />}
                        title={t('sa_actionRecalc')}
                        text={t('sa_actionRecalcText')}
                        button={t('sa_actionRecalcButton')}
                        disabled={!alive || !source.active || !source.settings.costs}
                        onClick={() => setDialog('recalc')}
                    />
                    <Divider />
                    <ActionRow
                        icon={<CalendarMonth />}
                        title={t('sa_actionRecover')}
                        text={t('sa_actionRecoverText')}
                        button={t('sa_actionRecoverButton')}
                        disabled={!alive}
                        onClick={() => void recoverPeriods()}
                    />
                    <Divider />
                    <ActionRow
                        icon={source.enabled ? <Pause /> : <PlayArrow />}
                        title={source.enabled ? t('sa_actionDeactivate') : t('sa_actionActivate')}
                        text={source.enabled ? t('sa_actionDeactivateText') : t('sa_actionActivateText')}
                        button={source.enabled ? t('sa_actionDeactivateButton') : t('sa_actionActivateButton')}
                        disabled={!alive || source.orphan}
                        onClick={() => void toggleEnabled()}
                    />
                    <Divider />
                    <ActionRow
                        icon={<Delete />}
                        danger
                        title={t('sa_actionDelete')}
                        text={t('sa_actionDeleteText')}
                        button={t('sa_actionDeleteButton')}
                        disabled={!alive}
                        onClick={() => setDialog('delete')}
                    />
                    <Divider />
                    <ActionRow
                        icon={<History />}
                        planned
                        title={t('sa_actionSwitch')}
                        text={t('sa_actionSwitchText')}
                        button={t('sa_actionSwitchButton')}
                        disabled
                    />
                </Card>
            </Box>
            {dialog ? (
                <ActionDialog
                    type={dialog}
                    api={api}
                    alive={alive}
                    source={source}
                    units={overview.units}
                    onClose={text => {
                        setDialog(null);
                        if (text) {
                            props.onChanged(text);
                            if (dialog === 'delete') {
                                props.onBack();
                            }
                        }
                    }}
                />
            ) : null}
        </Box>
    );
}
