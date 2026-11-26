import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Collapse,
    FormControlLabel,
    IconButton,
    LinearProgress,
    MenuItem,
    Radio,
    Step,
    StepButton,
    Stepper,
    Table,
    TableBody,
    TableCell,
    TableRow,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
} from '@mui/material';
import { Bolt, CheckCircle, Close, Search } from '@mui/icons-material';
import { DialogSelectID } from '@iobroker/gui-components';

import {
    convertUnit,
    isCountUnit,
    isPowerUnit,
    locale,
    nf,
    parseNum,
    periodStarts,
    send,
    slug,
    startFields,
    startValueErrors,
    t,
    unitsCompatible,
    type Api,
    type Overview,
    type StartField,
    type UnitInfo,
} from './api';
import { Card, tabular } from './ui';

interface Candidate {
    id: string;
    name: string;
    unit: string;
    role: string;
    usedBy: string | null;
    value: ioBroker.StateValue | null;
    dailyCounter: boolean;
}

interface WizardProps {
    api: Api;
    alive: boolean;
    overview: Overview;
    themeName: string;
    themeType: string;
    onClose: () => void;
    onOpenSource: (id: string) => void;
    onCreated: () => void;
}

const steps = ['datapoint', 'kind', 'unit', 'price', 'calculation', 'start', 'name'] as const;
// Shown first in the unit lists; all units come from the adapter (#1313)
const preferredUnits = ['W', 'kW', 'Wh', 'kWh', 'MWh', 'm³', 'l'];
const reservedOutputIds = ['info', 'priceDefinitions', 'priceHistory', 'basicPriceHistory'];
// Units of adapters before unitInfo was part of the overview
const fallbackUnitInfo: UnitInfo = {
    W: { exponent: 0, category: 'Watt' },
    kW: { exponent: 3, category: 'Watt' },
    Wh: { exponent: 0, category: 'Watt_hour' },
    kWh: { exponent: 3, category: 'Watt_hour' },
    MWh: { exponent: 6, category: 'Watt_hour' },
    'm³': { exponent: 0, category: 'Cubic_meter' },
    l: { exponent: 0, category: 'Liter' },
};

export default function Wizard(props: WizardProps): React.JSX.Element {
    const { api, overview } = props;
    const unitInfo = overview.unitInfo || fallbackUnitInfo;
    const sortedUnits = [
        ...preferredUnits.filter(entry => unitInfo[entry]),
        ...Object.keys(unitInfo).filter(entry => !preferredUnits.includes(entry)),
    ];
    const powerUnits = sortedUnits.filter(entry => isPowerUnit(unitInfo, entry));
    const meterUnits = sortedUnits.filter(entry => !isPowerUnit(unitInfo, entry));
    const narrow = useMediaQuery('(max-width:600px)');
    const [step, setStep] = useState(0);
    const [done, setDone] = useState(0);
    const [query, setQuery] = useState('');
    const [candidates, setCandidates] = useState<Candidate[] | null>(null);
    const [selectOpen, setSelectOpen] = useState(false);
    const [datapoint, setDatapoint] = useState<Candidate | null>(null);
    const [kind, setKind] = useState<'meter' | 'power'>('meter');
    // Reset detection is on by default, like in the adapter (#1313)
    const [resetJumps, setResetJumps] = useState<'yes' | 'no'>('yes');
    const [pulses, setPulses] = useState('');
    const [unit, setUnit] = useState('');
    const [price, setPrice] = useState('');
    const [basicRate, setBasicRate] = useState(true);
    const [flags, setFlags] = useState({ consumption: true, costs: true, meter_values: true });
    const [expert, setExpert] = useState(false);
    const [expertValues, setExpertValues] = useState({
        averagePowerValues: false,
        ignoreNegativeValues: false,
        decimalsQuantity: '',
        decimalsCosts: '',
        threshold: '1',
    });
    const [startMode, setStartMode] = useState<'now' | 'since'>('now');
    const [starts, setStarts] = useState<Partial<Record<StartField, string>>>({});
    const [name, setName] = useState('');
    const [outputId, setOutputId] = useState('');
    const [outputIdTouched, setOutputIdTouched] = useState(false);
    const [usedOutputIds, setUsedOutputIds] = useState<Record<string, string | null>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [created, setCreated] = useState<{ id: string; firstValue: number | null } | null>(null);

    // Datapoints with a known unit
    useEffect(() => {
        const timer = setTimeout(() => {
            void send<{ candidates: Candidate[] }>(api, 'findCandidates', { query }).then(result =>
                setCandidates(result.candidates || []),
            );
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        void send<Record<string, string | null>>(api, 'getUsedOutputIds').then(result =>
            setUsedOutputIds(result || {}),
        );
    }, []);

    // Suggestions from the datapoint
    const selectDatapoint = (candidate: Candidate): void => {
        setDatapoint(candidate);
        const isPower = isPowerUnit(unitInfo, candidate.unit);
        setKind(isPower ? 'power' : 'meter');
        setUnit(candidate.unit);
        if (!name) {
            setName(candidate.name || candidate.id.split('.').pop() || '');
        }
    };

    const calcUnit = overview.priceDefinitions.find(entry => entry.cat === price)?.unitType || '';
    const currentValue =
        typeof datapoint?.value === 'number' ? datapoint.value : parseNum(String(datapoint?.value ?? ''));
    const pulsesPerUnit = parseNum(pulses);
    const validPulses = pulsesPerUnit !== null && !Number.isNaN(pulsesPerUnit) && pulsesPerUnit > 0 ? pulsesPerUnit : 0;
    const countSource = isCountUnit(unitInfo, unit);
    const currentInCalcUnit =
        currentValue !== null && !Number.isNaN(currentValue)
            ? countSource && validPulses && !isCountUnit(unitInfo, calcUnit)
                ? currentValue / validPulses
                : convertUnit(unitInfo, currentValue, unit, calcUnit)
            : null;
    const startErrors = useMemo(
        () => (startMode === 'since' && kind === 'meter' ? startValueErrors(starts, currentInCalcUnit, calcUnit) : {}),
        [starts, startMode, currentInCalcUnit, calcUnit],
    );
    const effectiveOutputId = outputIdTouched ? outputId : slug(name, datapoint?.id || '');
    const outputIdError = !/^[A-Za-z0-9_-]+$/.test(effectiveOutputId)
        ? t('sa_errOutputId')
        : reservedOutputIds.includes(effectiveOutputId)
          ? t('sa_errOutputIdReserved')
          : usedOutputIds[effectiveOutputId] && usedOutputIds[effectiveOutputId] !== datapoint?.id
            ? t('sa_errOutputIdUsed')
            : '';
    const othersWithBasicFee = overview.sources.filter(
        source => source.enabled && source.priceDefinition === price && source.basicRate && source.id !== datapoint?.id,
    );
    useEffect(() => {
        setBasicRate(othersWithBasicFee.length === 0);
    }, [price]);

    const valid = [
        !!datapoint && !datapoint.usedBy,
        true,
        !!unit,
        !!price,
        true,
        Object.keys(startErrors).length === 0,
        !!name.trim() && !outputIdError,
    ];

    const settings = (): Record<string, any> => {
        const result: Record<string, any> = {
            enabled: true,
            alias: name.trim(),
            outputId: effectiveOutputId,
            selectedUnit: unit === datapoint?.unit ? 'Detect automatically' : unit,
            selectedPrice: price,
            basicRate,
            consumption: flags.consumption,
            costs: flags.costs,
            meter_values: flags.meter_values,
            deviceResetLogicEnabled: resetJumps === 'yes',
            ignoreNegativeValues: expertValues.ignoreNegativeValues,
            threshold: parseNum(expertValues.threshold) ?? 1,
        };
        if (kind === 'power') {
            result.averagePowerValues = expertValues.averagePowerValues;
        }
        if (countSource && validPulses) {
            result.pulsesPerUnit = validPulses;
        }
        for (const key of ['decimalsQuantity', 'decimalsCosts'] as const) {
            const value = parseNum(expertValues[key]);
            if (value !== null && !Number.isNaN(value)) {
                result[key] = value;
            }
        }
        if (startMode === 'since' && kind === 'meter') {
            for (const field of startFields) {
                const value = parseNum(starts[field]);
                if (value !== null && !Number.isNaN(value)) {
                    result[field] = value;
                }
            }
        }
        return result;
    };

    const activate = async (): Promise<void> => {
        if (!datapoint) {
            return;
        }
        setSaving(true);
        setSaveError('');
        const result = await send(api, 'saveSource', { source: datapoint.id, settings: settings() });
        setSaving(false);
        if (result.error) {
            setSaveError(
                result.errors
                    ? Object.keys(result.errors)
                          .map(key => t(`sa_field_${key}`))
                          .join(', ')
                    : result.message || '',
            );
            return;
        }
        setCreated({ id: datapoint.id, firstValue: null });
        props.onCreated();
    };

    // Wait for the first value of the new source. Power sources that only report on change can take
    // long: after a minute the page says so, and polling stops after ten minutes (#1313)
    const [waitedLong, setWaitedLong] = useState(false);
    useEffect(() => {
        if (!created || created.firstValue !== null) {
            return;
        }
        const startedAt = Date.now();
        const timer = setInterval(() => {
            const waited = Date.now() - startedAt;
            if (waited > 60_000) {
                setWaitedLong(true);
            }
            if (waited > 600_000) {
                clearInterval(timer);
                return;
            }
            void send<Overview>(api, 'getSources').then(result => {
                const source = result.sources?.find(entry => entry.id === created.id);
                if (
                    source?.active &&
                    source.cumulative !== null &&
                    source.cumulative !== undefined &&
                    source.lastUpdate
                ) {
                    setCreated({ id: created.id, firstValue: source.cumulative });
                }
            });
        }, 3000);
        return () => clearInterval(timer);
    }, [created]);

    const next = (): void => {
        setDone(Math.max(done, step + 1));
        setStep(step + 1);
    };

    if (created) {
        return (
            <Card>
                <Box sx={{ textAlign: 'center', py: 4 }}>
                    {created.firstValue === null ? (
                        <>
                            <CircularProgress />
                            <Typography sx={{ mt: 2 }}>{t('sa_wizardWaiting', name)}</Typography>
                            {waitedLong ? (
                                <Typography
                                    color="text.secondary"
                                    sx={{ mt: 1 }}
                                >
                                    {t('sa_wizardWaitingLong')}
                                </Typography>
                            ) : null}
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 2 }}>
                                <Button onClick={() => props.onOpenSource(created.id)}>{t('sa_toSource')}</Button>
                                <Button onClick={props.onClose}>{t('sa_toOverview')}</Button>
                            </Box>
                        </>
                    ) : (
                        <>
                            <CheckCircle
                                color="success"
                                sx={{ fontSize: 48 }}
                            />
                            <Typography sx={{ mt: 1, fontSize: 18 }}>{t('sa_wizardRunning', name)}</Typography>
                            <Typography color="text.secondary">
                                {t('sa_wizardFirstValue', nf(created.firstValue, 3), calcUnit)}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 2 }}>
                                <Button
                                    variant="contained"
                                    onClick={() => props.onOpenSource(created.id)}
                                >
                                    {t('sa_toSource')}
                                </Button>
                                <Button onClick={props.onClose}>{t('sa_toOverview')}</Button>
                            </Box>
                        </>
                    )}
                </Box>
            </Card>
        );
    }

    const starts_ = periodStarts(new Date());
    const renderStep = (): React.JSX.Element => {
        switch (steps[step]) {
            case 'datapoint':
                return (
                    <Box>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <TextField
                                size="small"
                                sx={{ flex: 1, minWidth: 220 }}
                                placeholder={t('sa_searchDatapoint')}
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                slotProps={{ input: { startAdornment: <Search fontSize="small" /> } }}
                            />
                            <Button
                                variant="outlined"
                                onClick={() => setSelectOpen(true)}
                            >
                                {t('sa_selectObject')}
                            </Button>
                        </Box>
                        <Alert
                            severity="info"
                            sx={{ my: 2 }}
                        >
                            {t('sa_wizardTotalCounter')}
                        </Alert>
                        <Typography sx={{ fontWeight: 500, mb: 1 }}>{t('sa_matchingDatapoints')}</Typography>
                        {candidates === null ? <LinearProgress /> : null}
                        {candidates?.length === 0 ? (
                            <Typography color="text.secondary">{t('sa_noCandidates')}</Typography>
                        ) : null}
                        {candidates?.map(candidate => (
                            <Box
                                key={candidate.id}
                                onClick={() => !candidate.usedBy && selectDatapoint(candidate)}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    py: 0.5,
                                    opacity: candidate.usedBy ? 0.5 : 1,
                                    cursor: candidate.usedBy ? 'default' : 'pointer',
                                    borderBottom: 1,
                                    borderColor: 'divider',
                                }}
                            >
                                <Radio
                                    checked={datapoint?.id === candidate.id}
                                    disabled={!!candidate.usedBy}
                                />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={{ fontSize: 14 }}>{candidate.name || candidate.id}</Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: 'monospace',
                                            fontSize: 12,
                                            color: 'text.secondary',
                                            wordBreak: 'break-all',
                                        }}
                                    >
                                        {candidate.id}
                                    </Typography>
                                </Box>
                                {candidate.usedBy ? (
                                    <Chip
                                        size="small"
                                        label={t('sa_alreadySource', candidate.usedBy)}
                                    />
                                ) : null}
                                {candidate.dailyCounter ? (
                                    <Chip
                                        size="small"
                                        color="warning"
                                        label={t('sa_dailyCounter')}
                                    />
                                ) : null}
                                <Typography
                                    sx={{ fontSize: 13, ...tabular }}
                                >{`${String(candidate.value ?? '–')} ${candidate.unit}`}</Typography>
                            </Box>
                        ))}
                        {datapoint?.dailyCounter ? (
                            <Alert
                                severity="warning"
                                sx={{ mt: 2 }}
                            >
                                {t('sa_dailyCounterWarning')}
                            </Alert>
                        ) : null}
                        {selectOpen ? (
                            <DialogSelectID
                                socket={api.socket}
                                theme={api.theme}
                                themeName={props.themeName as any}
                                themeType={props.themeType as any}
                                types={['state']}
                                onClose={() => setSelectOpen(false)}
                                onOk={async (selected: string | string[] | undefined) => {
                                    setSelectOpen(false);
                                    const id = Array.isArray(selected) ? selected[0] : selected;
                                    if (!id) {
                                        return;
                                    }
                                    const object = (await api.socket.getObject(id)) as ioBroker.StateObject | null;
                                    const state = await api.socket.getState(id);
                                    const objectName = object?.common?.name;
                                    selectDatapoint({
                                        id,
                                        name:
                                            typeof objectName === 'object'
                                                ? objectName.de || objectName.en
                                                : objectName || '',
                                        unit: object?.common?.unit || '',
                                        role: object?.common?.role || '',
                                        usedBy:
                                            overview.sources.find(source => source.id === id && source.enabled)?.name ||
                                            null,
                                        value: state?.val ?? null,
                                        dailyCounter: false,
                                    });
                                }}
                            />
                        ) : null}
                    </Box>
                );
            case 'kind':
                return (
                    <Box>
                        <Typography sx={{ mb: 2 }}>
                            {t(
                                'sa_kindSuggestion',
                                datapoint?.unit || '–',
                                powerUnits.includes(datapoint?.unit || '') ? t('sa_kindPower') : t('sa_kindMeter'),
                            )}
                        </Typography>
                        <Box
                            sx={{
                                display: 'grid',
                                gap: 2,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            }}
                        >
                            {(['meter', 'power'] as const).map(option => (
                                <Card
                                    key={option}
                                    onClick={() => {
                                        setKind(option);
                                        setUnit(
                                            option === 'power'
                                                ? powerUnits.includes(unit)
                                                    ? unit
                                                    : 'W'
                                                : meterUnits.includes(unit)
                                                  ? unit
                                                  : 'Wh',
                                        );
                                    }}
                                    sx={{
                                        outline: kind === option ? 2 : 0,
                                        outlineColor: 'primary.main',
                                        outlineStyle: 'solid',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Radio checked={kind === option} />
                                        <Typography sx={{ fontWeight: 500 }}>
                                            {option === 'power' ? t('sa_kindPower') : t('sa_kindMeter')}
                                        </Typography>
                                    </Box>
                                    <svg
                                        viewBox="0 0 120 36"
                                        width="100%"
                                        height="36"
                                        aria-hidden
                                    >
                                        {option === 'meter' ? (
                                            <polyline
                                                points="0,34 20,30 40,26 60,20 80,14 100,9 120,4"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                            />
                                        ) : (
                                            <polyline
                                                points="0,28 15,10 30,24 45,8 60,30 75,14 90,20 105,6 120,22"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                            />
                                        )}
                                    </svg>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                    >
                                        {option === 'power' ? t('sa_kindPowerText') : t('sa_kindMeterText')}
                                    </Typography>
                                </Card>
                            ))}
                        </Box>
                        {kind === 'meter' ? (
                            <Box sx={{ mt: 3 }}>
                                <Typography sx={{ mb: 1 }}>{t('sa_resetQuestion')}</Typography>
                                <ToggleButtonGroup
                                    exclusive
                                    size="small"
                                    value={resetJumps}
                                    onChange={(_e, value) => value && setResetJumps(value)}
                                >
                                    <ToggleButton value="yes">{t('sa_yes')}</ToggleButton>
                                    <ToggleButton value="no">{t('sa_no')}</ToggleButton>
                                </ToggleButtonGroup>
                                {/shelly|tasmota/i.test(datapoint?.id || '') ? (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ mt: 1 }}
                                    >
                                        {t('sa_resetShelly')}
                                    </Typography>
                                ) : null}
                            </Box>
                        ) : null}
                    </Box>
                );
            case 'unit':
                return (
                    <Box>
                        <TextField
                            select
                            label={t('sa_unit')}
                            value={unit}
                            onChange={e => setUnit(e.target.value)}
                            sx={{ minWidth: 200 }}
                            helperText={t('sa_unitDetected', datapoint?.unit || t('sa_none'))}
                        >
                            {(kind === 'power'
                                ? powerUnits
                                : meterUnits.concat(
                                      overview.units.filter(
                                          entry => !meterUnits.includes(entry) && !powerUnits.includes(entry),
                                      ),
                                  )
                            ).map(entry => (
                                <MenuItem
                                    key={entry}
                                    value={entry}
                                >
                                    {entry}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Box>
                );
            case 'price': {
                const matching = (entryUnit: string): boolean =>
                    unitsCompatible(unitInfo, unit, entryUnit, validPulses);
                const sorted = [...overview.priceDefinitions].sort(
                    (a, b) => Number(matching(b.unitType)) - Number(matching(a.unitType)),
                );
                return (
                    <Box>
                        {countSource ? (
                            <TextField
                                size="small"
                                sx={{ mb: 2, minWidth: 260 }}
                                label={t('sa_wizardPulses')}
                                value={pulses}
                                error={pulses !== '' && !validPulses}
                                helperText={
                                    pulses !== '' && !validPulses ? t('sa_errNumber') : t('sa_wizardPulsesHelp')
                                }
                                onChange={e => setPulses(e.target.value)}
                                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                            />
                        ) : null}
                        {sorted.length === 0 ? <Alert severity="warning">{t('sa_noPrices')}</Alert> : null}
                        {sorted.map(entry => {
                            const ok = matching(entry.unitType);
                            return (
                                <Box
                                    key={entry.cat}
                                    onClick={() => ok && setPrice(entry.cat)}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        opacity: ok ? 1 : 0.5,
                                        cursor: ok ? 'pointer' : 'default',
                                    }}
                                >
                                    <Radio
                                        checked={price === entry.cat}
                                        disabled={!ok}
                                    />
                                    <Box sx={{ flex: 1 }}>
                                        <Typography sx={{ fontSize: 14 }}>{entry.cat}</Typography>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >
                                            {`${entry.costType === 'earnings' ? t('sa_delivery') : t('sa_consumption')} · ${nf(entry.unitPrice, 4)} €/${entry.unitType} · ${t('sa_basicPricePerMonth', nf(entry.basicPrice, 2))}`}
                                        </Typography>
                                    </Box>
                                    {!ok ? (
                                        <Chip
                                            size="small"
                                            label={t('sa_otherUnit')}
                                        />
                                    ) : null}
                                </Box>
                            );
                        })}
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 1 }}
                        >
                            {t('sa_newPriceHint')}
                        </Typography>
                        {price ? (
                            <FormControlLabel
                                sx={{ mt: 2 }}
                                control={
                                    <Checkbox
                                        checked={basicRate}
                                        onChange={e => setBasicRate(e.target.checked)}
                                    />
                                }
                                label={t('sa_includeBasicFee')}
                            />
                        ) : null}
                        {price && othersWithBasicFee.length ? (
                            <Alert severity="warning">
                                {t('sa_basicFeeTwiceHint', othersWithBasicFee.map(source => source.name).join(', '))}
                            </Alert>
                        ) : null}
                    </Box>
                );
            }
            case 'calculation':
                return (
                    <Box>
                        {(['consumption', 'costs', 'meter_values'] as const).map(flag => (
                            <FormControlLabel
                                key={flag}
                                sx={{ display: 'flex' }}
                                control={
                                    <Checkbox
                                        checked={flags[flag]}
                                        onChange={e => setFlags({ ...flags, [flag]: e.target.checked })}
                                    />
                                }
                                label={t(`sa_flag_${flag}`)}
                            />
                        ))}
                        <Button
                            size="small"
                            onClick={() => setExpert(!expert)}
                        >
                            {t('sa_forExperts')}
                        </Button>
                        <Collapse in={expert}>
                            <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
                                {kind === 'power' ? (
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={expertValues.averagePowerValues}
                                                onChange={e =>
                                                    setExpertValues({
                                                        ...expertValues,
                                                        averagePowerValues: e.target.checked,
                                                    })
                                                }
                                            />
                                        }
                                        label={t('sa_flag_averagePowerValues')}
                                    />
                                ) : null}
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={expertValues.ignoreNegativeValues}
                                            onChange={e =>
                                                setExpertValues({
                                                    ...expertValues,
                                                    ignoreNegativeValues: e.target.checked,
                                                })
                                            }
                                        />
                                    }
                                    label={t('sa_flag_ignoreNegativeValues')}
                                />
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gap: 2,
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                    }}
                                >
                                    <TextField
                                        size="small"
                                        label={t('sa_decimalsQuantity')}
                                        value={expertValues.decimalsQuantity}
                                        onChange={e =>
                                            setExpertValues({ ...expertValues, decimalsQuantity: e.target.value })
                                        }
                                    />
                                    <TextField
                                        size="small"
                                        label={t('sa_decimalsCosts')}
                                        value={expertValues.decimalsCosts}
                                        onChange={e =>
                                            setExpertValues({ ...expertValues, decimalsCosts: e.target.value })
                                        }
                                    />
                                    {kind === 'meter' ? (
                                        <TextField
                                            size="small"
                                            label={t('sa_threshold', calcUnit)}
                                            value={expertValues.threshold}
                                            onChange={e =>
                                                setExpertValues({ ...expertValues, threshold: e.target.value })
                                            }
                                        />
                                    ) : null}
                                </Box>
                            </Box>
                        </Collapse>
                    </Box>
                );
            case 'start':
                return (
                    <Box>
                        <Box
                            sx={{
                                display: 'grid',
                                gap: 2,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                            }}
                        >
                            {(['now', 'since'] as const).map(option => {
                                const disabled = option === 'since' && kind === 'power';
                                return (
                                    <Card
                                        key={option}
                                        onClick={() => !disabled && setStartMode(option)}
                                        sx={{
                                            opacity: disabled ? 0.5 : 1,
                                            outline: startMode === option ? 2 : 0,
                                            outlineColor: 'primary.main',
                                            outlineStyle: 'solid',
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                            <Radio
                                                checked={startMode === option}
                                                disabled={disabled}
                                            />
                                            <Typography sx={{ fontWeight: 500 }}>{t(`sa_start_${option}`)}</Typography>
                                            {option === 'now' ? (
                                                <Chip
                                                    size="small"
                                                    label={t('sa_recommended')}
                                                    sx={{ ml: 1 }}
                                                />
                                            ) : null}
                                        </Box>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >
                                            {t(`sa_start_${option}Text`)}
                                        </Typography>
                                    </Card>
                                );
                            })}
                        </Box>
                        {startMode === 'since' ? (
                            <Box sx={{ mt: 2 }}>
                                <Alert severity="info">{t('sa_startInfo', calcUnit)}</Alert>
                                {Object.keys(startErrors).length ? (
                                    <Alert
                                        severity="error"
                                        sx={{ mt: 2 }}
                                    >
                                        {t('sa_startBlocked', t(`sa_period_${Object.keys(startErrors)[0]}`))}
                                    </Alert>
                                ) : null}
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gap: 2,
                                        mt: 2,
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                    }}
                                >
                                    {startFields.map(field => {
                                        const value = parseNum(starts[field]);
                                        const since =
                                            value !== null && !Number.isNaN(value) && currentInCalcUnit !== null
                                                ? t('sa_sinceStart', nf(currentInCalcUnit - value, 3), calcUnit)
                                                : '';
                                        return (
                                            <TextField
                                                key={field}
                                                label={t(
                                                    'sa_startLabel',
                                                    t(`sa_period_${field}`),
                                                    starts_[field].toLocaleDateString(locale(), {
                                                        weekday: 'short',
                                                        day: '2-digit',
                                                        month: '2-digit',
                                                    }),
                                                )}
                                                value={starts[field] || ''}
                                                onChange={e => setStarts({ ...starts, [field]: e.target.value })}
                                                error={!!startErrors[field]}
                                                helperText={startErrors[field] || since}
                                                slotProps={{
                                                    htmlInput: { inputMode: 'decimal' },
                                                    input: { endAdornment: calcUnit },
                                                }}
                                            />
                                        );
                                    })}
                                </Box>
                            </Box>
                        ) : null}
                    </Box>
                );
            default:
                return (
                    <Box>
                        <TextField
                            fullWidth
                            label={t('sa_name')}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            helperText={t('sa_nameHelp', `${api.adapterName}.${api.instance}.${effectiveOutputId}`)}
                        />
                        <Button
                            size="small"
                            sx={{ mt: 1 }}
                            onClick={() => setExpert(!expert)}
                        >
                            {t('sa_forExperts')}
                        </Button>
                        <Collapse in={expert}>
                            <TextField
                                fullWidth
                                sx={{ mt: 1 }}
                                label={t('sa_outputId')}
                                value={effectiveOutputId}
                                onChange={e => {
                                    setOutputIdTouched(true);
                                    setOutputId(e.target.value);
                                }}
                                error={!!outputIdError}
                                helperText={outputIdError}
                                slotProps={{ input: { startAdornment: `${api.adapterName}.${api.instance}.` } }}
                            />
                        </Collapse>
                        {outputIdError && !expert ? (
                            <Alert
                                severity="error"
                                sx={{ mt: 1 }}
                            >
                                {outputIdError}
                            </Alert>
                        ) : null}
                        <Table
                            size="small"
                            sx={{ mt: 2 }}
                        >
                            <TableBody>
                                {[
                                    [t('sa_datapoint'), datapoint?.id || '–'],
                                    [t('sa_kind'), kind === 'power' ? t('sa_kindPower') : t('sa_kindMeter')],
                                    [t('sa_unit'), calcUnit && unit !== calcUnit ? `${unit} → ${calcUnit}` : unit],
                                    [t('sa_price'), `${price}${basicRate ? ` + ${t('sa_basicFee')}` : ''}`],
                                    [
                                        t('sa_calculated'),
                                        (['consumption', 'costs', 'meter_values'] as const)
                                            .filter(flag => flags[flag])
                                            .map(flag => t(`sa_flag_${flag}`))
                                            .join(', '),
                                    ],
                                    [
                                        t('sa_flag_deviceResetLogicEnabled'),
                                        resetJumps === 'yes' ? t('sa_yes') : t('sa_no'),
                                    ],
                                    [
                                        t('sa_startValues'),
                                        startMode === 'now' ? t('sa_start_now') : t('sa_start_since'),
                                    ],
                                ].map(([label, value]) => (
                                    <TableRow key={label}>
                                        <TableCell sx={{ color: 'text.secondary', width: '40%' }}>{label}</TableCell>
                                        <TableCell>{value}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {saveError ? (
                            <Alert
                                severity="error"
                                sx={{ mt: 2 }}
                            >
                                {t('sa_saveFailed', saveError)}
                            </Alert>
                        ) : null}
                    </Box>
                );
        }
    };

    return (
        <Card>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Typography sx={{ fontSize: 18, fontWeight: 500, flex: 1 }}>{t('sa_addSource')}</Typography>
                <IconButton
                    onClick={props.onClose}
                    aria-label={t('sa_close')}
                >
                    <Close />
                </IconButton>
            </Box>
            {narrow ? (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="body2">
                        {t('sa_stepOf', step + 1, steps.length, t(`sa_step_${steps[step]}`))}
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={(100 * (step + 1)) / steps.length}
                        sx={{ height: 4, mt: 0.5 }}
                    />
                </Box>
            ) : (
                <Stepper
                    nonLinear
                    activeStep={step}
                    sx={{ mb: 3 }}
                >
                    {steps.map((entry, index) => (
                        <Step
                            key={entry}
                            completed={index < done && index !== step}
                        >
                            <StepButton
                                disabled={index > done}
                                onClick={() => setStep(index)}
                            >
                                {t(`sa_step_${entry}`)}
                            </StepButton>
                        </Step>
                    ))}
                </Stepper>
            )}
            {renderStep()}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
                <Button
                    disabled={step === 0}
                    onClick={() => setStep(step - 1)}
                >
                    {t('sa_back')}
                </Button>
                {step < steps.length - 1 ? (
                    <Button
                        variant="contained"
                        disabled={!valid[step]}
                        onClick={next}
                    >
                        {t('sa_next')}
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        startIcon={<Bolt />}
                        disabled={!props.alive || !valid.every(Boolean) || saving}
                        onClick={() => void activate()}
                    >
                        {t('sa_activate')}
                    </Button>
                )}
            </Box>
        </Card>
    );
}
