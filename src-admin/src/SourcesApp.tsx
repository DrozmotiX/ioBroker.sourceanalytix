import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    Divider,
    Paper,
    Skeleton,
    Snackbar,
    Typography,
} from '@mui/material';
import {
    Add,
    Bolt,
    ChevronRight,
    CloudOff,
    Error as ErrorIcon,
    Lightbulb,
    PlayArrow,
    PowerOff,
    Refresh,
    Warning,
    CheckCircle,
} from '@mui/icons-material';

import {
    ago,
    money,
    nf,
    send,
    sourceIcon,
    statusText,
    t,
    type Api,
    type Overview,
    type Problem,
    type Source,
} from './api';
import { ActionDialog, type DialogType } from './Dialogs';
import SourceDetail from './SourceDetail';
import Wizard from './Wizard';
import { Card, SourceAvatar, StatusChip, tabular } from './ui';

function countText(kind: 'Problems' | 'Hints', count: number): string {
    return t(count === 1 ? `sa_one${kind}` : `sa_n${kind}`, String(count));
}

export interface SourcesAppProps {
    api: Api;
    view: 'overview' | 'problems';
    themeName: string;
}

type Screen = { type: 'list' } | { type: 'wizard' } | { type: 'detail'; id: string };

function useAlive(api: Api): boolean {
    const [alive, setAlive] = useState(false);
    useEffect(() => {
        const id = `system.adapter.${api.adapterName}.${api.instance}.alive`;
        const handler = (_id: string, state: ioBroker.State | null | undefined): void => setAlive(!!state?.val);
        void api.socket.getState(id).then(state => setAlive(!!state?.val));
        void api.socket.subscribeState(id, handler);
        return () => api.socket.unsubscribeState(id, handler);
    }, [api]);
    return alive;
}

function useOverview(
    api: Api,
    alive: boolean,
): {
    overview: Overview | null;
    error: string;
    loading: boolean;
    reload: () => Promise<void>;
} {
    const [overview, setOverview] = useState<Overview | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const reload = useCallback(async () => {
        try {
            const result = await send<Overview>(api, 'getSources');
            if (!result || !result.ok) {
                throw new Error((result as any)?.message || 'no answer');
            }
            setOverview(result);
            setError('');
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [api]);
    useEffect(() => {
        if (!alive) {
            setLoading(false);
            return;
        }
        setLoading(true);
        void reload();
        // Live values: refresh while the page is open
        const timer = setInterval(() => void reload(), 15_000);
        return () => clearInterval(timer);
    }, [alive, reload]);
    return { overview, error, loading, reload };
}

function NotAliveBanner(props: { api: Api }): React.JSX.Element {
    return (
        <Alert
            severity="error"
            icon={<PowerOff />}
            sx={{ mb: 2 }}
            action={
                <Button
                    variant="contained"
                    color="error"
                    size="small"
                    startIcon={<PlayArrow />}
                    onClick={() =>
                        void props.api.socket.extendObject(
                            `system.adapter.${props.api.adapterName}.${props.api.instance}`,
                            {
                                common: { enabled: true },
                            },
                        )
                    }
                >
                    {t('sa_start')}
                </Button>
            }
        >
            <Typography sx={{ fontWeight: 500 }}>{t('sa_notRunning')}</Typography>
            {t('sa_notRunningText')}
        </Alert>
    );
}

function InstantHint(): React.JSX.Element {
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 2,
                px: 2,
                py: 1,
                borderRadius: 1,
                bgcolor: theme => (theme.palette.mode === 'dark' ? 'rgba(108,180,238,.12)' : 'rgba(31,111,168,.08)'),
            }}
        >
            <Bolt
                fontSize="small"
                color="primary"
            />
            <Typography variant="body2">{t('sa_instantHint')}</Typography>
        </Box>
    );
}

function SourceCard(props: {
    source: Source;
    problems: Problem[];
    currency?: string | null;
    onClick: () => void;
}): React.JSX.Element {
    const { source } = props;
    const unit = source.calcUnit || source.unit || '';
    const earnings = source.costType === 'earnings';
    const short = statusText(source, props.problems);
    const statusColor =
        source.status === 'error' ? 'error.main' : source.status === 'warning' ? 'warning.main' : 'text.secondary';
    return (
        <Card
            onClick={props.onClick}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                <SourceAvatar icon={sourceIcon(source)} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 16,
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {source.name}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                        {source.orphan
                            ? t('sa_orphan')
                            : source.kind === 'power'
                              ? t('sa_kindPowerUnit', source.unit || 'W', unit)
                              : t('sa_kindMeterUnit', unit)}
                    </Typography>
                </Box>
                <StatusChip status={source.status} />
            </Box>
            <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('sa_total')}</Typography>
                <Typography sx={{ fontSize: 22, ...tabular }}>
                    {source.cumulative !== null && source.cumulative !== undefined
                        ? `${nf(source.cumulative, 1)} ${unit}`
                        : '–'}
                </Typography>
            </Box>
            <Divider />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                {(
                    [
                        ['01_currentDay', 'sa_today'],
                        ['03_currentMonth', 'sa_month'],
                        ['05_currentYear', 'sa_year'],
                    ] as const
                ).map(([period, label]) => (
                    <Box key={period}>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t(label)}</Typography>
                        <Typography sx={{ fontSize: 14, fontWeight: 500, ...tabular }}>
                            {`${nf(source.values[period]?.quantity, 1)} ${unit}`}
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: 'text.secondary', ...tabular }}>
                            {earnings ? `${t('sa_earningsShort')} ` : ''}
                            {money(source.values[period]?.money, props.currency)}
                        </Typography>
                    </Box>
                ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, fontSize: 12 }}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>
                    {t('sa_updated', ago(source.lastUpdate))}
                </Typography>
                {short ? <Typography sx={{ fontSize: 12, color: statusColor }}>{short}</Typography> : null}
            </Box>
        </Card>
    );
}

function EmptyState(props: { onAdd: () => void }): React.JSX.Element {
    return (
        <Card sx={{ maxWidth: 560, mx: 'auto', textAlign: 'center', p: 4 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 500, mb: 2 }}>{t('sa_setupTitle')}</Typography>
            {['sa_setupStep1', 'sa_setupStep2', 'sa_setupStep3'].map((key, index) => (
                <Box
                    key={key}
                    sx={{ display: 'flex', gap: 1.5, alignItems: 'center', textAlign: 'left', mb: 1 }}
                >
                    <Chip
                        label={index + 1}
                        color="primary"
                        size="small"
                    />
                    <Typography>{t(key)}</Typography>
                </Box>
            ))}
            <Button
                variant="contained"
                size="large"
                startIcon={<Add />}
                sx={{ mt: 2 }}
                onClick={props.onAdd}
            >
                {t('sa_addFirstSource')}
            </Button>
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1 }}
            >
                {t('sa_setupPriceHint')}
            </Typography>
        </Card>
    );
}

function ErrorState(props: { error: string; onRetry: () => void }): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <Card sx={{ maxWidth: 560, mx: 'auto', textAlign: 'center', p: 4 }}>
            <CloudOff sx={{ fontSize: 48, color: 'text.secondary' }} />
            <Typography sx={{ fontSize: 18, fontWeight: 500 }}>{t('sa_loadFailed')}</Typography>
            <Typography color="text.secondary">{t('sa_loadFailedText')}</Typography>
            <Button
                variant="contained"
                startIcon={<Refresh />}
                sx={{ mt: 2 }}
                onClick={props.onRetry}
            >
                {t('sa_retry')}
            </Button>
            <Box>
                <Button
                    size="small"
                    onClick={() => setOpen(!open)}
                    sx={{ mt: 1 }}
                >
                    {t('sa_forExperts')}
                </Button>
                <Collapse in={open}>
                    <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace' }}
                    >
                        {props.error}
                    </Typography>
                </Collapse>
            </Box>
        </Card>
    );
}

function LoadingState(): React.JSX.Element {
    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <CircularProgress size={20} />
                <Typography>{t('sa_loading')}</Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 2 }}>
                {[0, 1, 2, 3, 4, 5].map(index => (
                    <Skeleton
                        key={index}
                        variant="rounded"
                        height={210}
                    />
                ))}
            </Box>
        </Box>
    );
}

function ProblemRow(props: {
    problem: Problem;
    alive: boolean;
    onFix: (problem: Problem) => void;
    onOpen: (problem: Problem) => void;
}): React.JSX.Element {
    const { problem } = props;
    const isError = problem.severity === 'error';
    const codeLabel = t(`sa_fixcode_${problem.code}`);
    const fixLabel = !problem.fix
        ? t('sa_guide')
        : codeLabel !== `sa_fixcode_${problem.code}`
          ? codeLabel
          : t(`sa_fix_${problem.fix.command}`);
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                py: 1.5,
                flexWrap: { xs: 'wrap', sm: 'nowrap' },
            }}
        >
            <Box
                sx={{
                    width: 96,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    color: isError ? 'error.main' : 'warning.main',
                }}
            >
                {isError ? <ErrorIcon fontSize="small" /> : <Warning fontSize="small" />}
                <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
                    {isError ? t('sa_status_error') : t('sa_hint')}
                </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography sx={{ fontSize: 14 }}>
                    <b>{problem.name}</b> · <span style={{ opacity: 0.75 }}>{t(`sa_problem_${problem.code}`)}</span>
                </Typography>
                <Typography
                    sx={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}
                >
                    <Lightbulb sx={{ fontSize: 16 }} />
                    {t(
                        `sa_suggest_${problem.code}`,
                        ...(Array.isArray(problem.others) ? [problem.others.join(', ')] : []),
                    )}
                </Typography>
            </Box>
            <Button
                size="small"
                variant={problem.fix ? 'contained' : 'outlined'}
                startIcon={problem.fix ? <Bolt /> : undefined}
                disabled={!!problem.fix && !props.alive}
                onClick={() => props.onFix(problem)}
                sx={{ height: 32 }}
            >
                {fixLabel}
            </Button>
            <Button
                size="small"
                onClick={() => props.onOpen(problem)}
                aria-label={t('sa_openSource')}
                sx={{ minWidth: 32 }}
            >
                <ChevronRight />
            </Button>
        </Box>
    );
}

const docsBase = 'https://github.com/DrozmotiX/ioBroker.sourceanalytix/blob/main/docs/de';
const guides: Record<string, string> = {
    stringValue: `${docsBase}/04.fehlerbehebung/01.log-meldungen.md`,
    powerSilent: `${docsBase}/01.erste-schritte/02.erster-zaehler.md`,
    startValue: `${docsBase}/02.anleitungen/02.zaehlerstaende-korrigieren.md#values-negative-after-entering-start`,
};

export default function SourcesApp(props: SourcesAppProps): React.JSX.Element {
    const { api } = props;
    const alive = useAlive(api);
    const { overview, error, loading, reload } = useOverview(api, alive);
    const [screen, setScreen] = useState<Screen>({ type: 'list' });
    const [snack, setSnack] = useState('');
    const [dialog, setDialog] = useState<{ type: DialogType; source: Source } | null>(null);
    const [passedOpen, setPassedOpen] = useState(false);
    const [highlight, setHighlight] = useState('');

    const changed = (text?: string): void => {
        if (text) {
            setSnack(text);
        }
        void reload();
    };

    const fix = async (problem: Problem): Promise<void> => {
        const source = overview?.sources.find(entry => entry.id === problem.source);
        if (!problem.fix) {
            window.open(guides[problem.code] || `${docsBase}/README.md`, '_blank');
            return;
        }
        if (!source) {
            return;
        }
        switch (problem.fix.command) {
            case 'fixUnit':
                setDialog({ type: 'unit', source });
                return;
            case 'setCumulative':
                setDialog({ type: 'align', source });
                return;
            case 'deleteSourceData':
                setDialog({ type: 'delete', source });
                return;
            case 'choosePrice':
                setScreen({ type: 'detail', id: source.id });
                return;
            case 'setSourceEnabled':
                await send(api, 'setSourceEnabled', { source: source.id, enabled: false });
                changed(t('sa_deactivated', source.name));
                return;
            case 'recoverPeriods':
                await send(api, 'recoverPeriods', { source: source.id });
                changed(t('sa_recovered', source.name));
                return;
            default:
                await send(api, problem.fix.command, { source: source.id, ...(problem.fix.message || {}) });
                changed(t('sa_fixed', source.name));
        }
    };

    const body = (): React.JSX.Element => {
        if (!alive && !overview) {
            return <Typography color="text.secondary">{t('sa_needsInstance')}</Typography>;
        }
        if (loading && !overview) {
            return <LoadingState />;
        }
        if (error && !overview) {
            return (
                <ErrorState
                    error={error}
                    onRetry={() => void reload()}
                />
            );
        }
        if (!overview) {
            return <LoadingState />;
        }
        if (screen.type === 'wizard') {
            return (
                <Wizard
                    api={api}
                    alive={alive}
                    overview={overview}
                    themeName={props.themeName}
                    themeType={api.themeType}
                    onClose={() => setScreen({ type: 'list' })}
                    onCreated={() => void reload()}
                    onOpenSource={id => setScreen({ type: 'detail', id })}
                />
            );
        }
        if (screen.type === 'detail') {
            const source = overview.sources.find(entry => entry.id === screen.id);
            if (source) {
                return (
                    <SourceDetail
                        key={`${source.id}:${JSON.stringify(source.settings)}`}
                        api={api}
                        alive={alive}
                        source={source}
                        overview={overview}
                        onBack={() => setScreen({ type: 'list' })}
                        onChanged={changed}
                    />
                );
            }
        }
        const problemCount = overview.problems.filter(problem => problem.severity === 'error').length;
        const hintCount = overview.problems.length - problemCount;
        if (props.view === 'problems') {
            return (
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: 20, fontWeight: 500 }}>{t('sa_problems')}</Typography>
                            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                                {t(
                                    'sa_problemCount',
                                    countText('Problems', problemCount),
                                    countText('Hints', hintCount),
                                    ago(overview.checkedAt),
                                )}
                            </Typography>
                        </Box>
                        <Button
                            variant="outlined"
                            startIcon={<Bolt />}
                            disabled={!alive}
                            onClick={() => changed()}
                        >
                            {t('sa_checkAgain')}
                        </Button>
                    </Box>
                    <Paper elevation={1}>
                        {overview.problems.length === 0 ? (
                            <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
                                <CheckCircle color="success" />
                                <Typography>{t('sa_noProblems')}</Typography>
                            </Box>
                        ) : null}
                        {overview.problems.map((problem, index) => (
                            <React.Fragment key={problem.id}>
                                {index ? <Divider /> : null}
                                <ProblemRow
                                    problem={problem}
                                    alive={alive}
                                    onFix={problem => void fix(problem)}
                                    onOpen={problem => setScreen({ type: 'detail', id: problem.source })}
                                />
                            </React.Fragment>
                        ))}
                    </Paper>
                    <Button
                        size="small"
                        sx={{ mt: 2 }}
                        onClick={() => setPassedOpen(!passedOpen)}
                    >
                        {t('sa_passedChecks', overview.passed.length)}
                    </Button>
                    <Collapse in={passedOpen}>
                        {overview.passed.map(code => (
                            <Box
                                key={code}
                                sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.5, pl: 1 }}
                            >
                                <CheckCircle
                                    color="success"
                                    fontSize="small"
                                />
                                <Typography variant="body2">{t(`sa_check_${code}`)}</Typography>
                            </Box>
                        ))}
                    </Collapse>
                </Box>
            );
        }
        if (!overview.sources.length) {
            return <EmptyState onAdd={() => setScreen({ type: 'wizard' })} />;
        }
        return (
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                    <Box sx={{ flex: 1 }}>
                        <Typography sx={{ fontSize: 20, fontWeight: 500 }}>{t('sa_sources')}</Typography>
                        <Typography
                            sx={{
                                fontSize: 13,
                                color: 'text.secondary',
                                display: 'flex',
                                gap: 1,
                                alignItems: 'center',
                                flexWrap: 'wrap',
                            }}
                        >
                            {t('sa_sourceCount', overview.sources.length)}
                            {problemCount ? (
                                <Box
                                    component="span"
                                    sx={{ color: 'error.main', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                                >
                                    · <ErrorIcon sx={{ fontSize: 14 }} />
                                    {countText('Problems', problemCount)}
                                </Box>
                            ) : null}
                            {hintCount ? (
                                <Box
                                    component="span"
                                    sx={{
                                        color: 'warning.main',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                    }}
                                >
                                    · <Warning sx={{ fontSize: 14 }} />
                                    {countText('Hints', hintCount)}
                                </Box>
                            ) : null}
                        </Typography>
                    </Box>
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={() => setScreen({ type: 'wizard' })}
                    >
                        {t('sa_addSource')}
                    </Button>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 2 }}>
                    {overview.sources.map(source => (
                        <Box
                            key={source.id}
                            sx={{
                                outline: highlight === source.id ? 2 : 0,
                                outlineStyle: 'solid',
                                outlineColor: 'primary.main',
                                borderRadius: 1,
                            }}
                        >
                            <SourceCard
                                source={source}
                                problems={overview.problems}
                                currency={overview.currency}
                                onClick={() => {
                                    setHighlight('');
                                    setScreen({ type: 'detail', id: source.id });
                                }}
                            />
                        </Box>
                    ))}
                    <Paper
                        variant="outlined"
                        sx={{
                            borderStyle: 'dashed',
                            p: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            minHeight: 120,
                        }}
                    >
                        <Typography color="text.secondary">{t('sa_sumAllSources')}</Typography>
                        <Chip
                            size="small"
                            label={t('sa_planned')}
                        />
                    </Paper>
                </Box>
            </Box>
        );
    };

    return (
        <Box sx={{ width: '100%', p: { xs: 1.5, sm: 3 }, boxSizing: 'border-box' }}>
            {!alive ? <NotAliveBanner api={api} /> : null}
            <InstantHint />
            {body()}
            {dialog ? (
                <ActionDialog
                    type={dialog.type}
                    api={api}
                    alive={alive}
                    source={dialog.source}
                    units={overview?.units}
                    onClose={text => {
                        setDialog(null);
                        if (text) {
                            changed(text);
                        }
                    }}
                />
            ) : null}
            <Snackbar
                open={!!snack}
                autoHideDuration={5000}
                onClose={() => setSnack('')}
                message={snack}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            />
        </Box>
    );
}
