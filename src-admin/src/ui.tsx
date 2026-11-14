import React from 'react';
import { Box, Chip, Paper, Typography, type SxProps, type Theme } from '@mui/material';
import {
    Bolt,
    CheckCircle,
    Error as ErrorIcon,
    HeatPump,
    LocalFireDepartment,
    LocalLaundryService,
    PauseCircle,
    SolarPower,
    Warning,
    WaterDrop,
} from '@mui/icons-material';

import { t, type Source } from './api';

const sourceIcons: Record<
    string,
    React.ComponentType<{ sx?: SxProps<Theme>; fontSize?: 'small' | 'medium' | 'large' | 'inherit' }>
> = {
    bolt: Bolt,
    solar_power: SolarPower,
    heat_pump: HeatPump,
    water_drop: WaterDrop,
    local_fire_department: LocalFireDepartment,
    local_laundry_service: LocalLaundryService,
};

export function SourceAvatar(props: { icon: string; size?: number }): React.JSX.Element {
    const Icon = sourceIcons[props.icon] || Bolt;
    const size = props.size || 40;
    return (
        <Box
            sx={{
                width: size,
                height: size,
                borderRadius: '50%',
                flex: `0 0 ${size}px`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: theme => (theme.palette.mode === 'dark' ? 'rgba(108,180,238,.16)' : 'rgba(31,111,168,.10)'),
                color: 'primary.main',
            }}
        >
            <Icon sx={{ fontSize: size * 0.55 }} />
        </Box>
    );
}

const statusColors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    ok: 'success',
    warning: 'warning',
    error: 'error',
    disabled: 'default',
};

const statusIcons: Record<string, React.JSX.Element> = {
    ok: <CheckCircle />,
    warning: <Warning />,
    error: <ErrorIcon />,
    disabled: <PauseCircle />,
};

/**
 * Status never only by colour: always icon and text
 *
 * @param props
 * @param props.status
 */
export function StatusChip(props: { status: Source['status'] | 'problem' | 'hint' }): React.JSX.Element {
    const status = props.status === 'problem' ? 'error' : props.status === 'hint' ? 'warning' : props.status || 'ok';
    return (
        <Chip
            size="small"
            variant="outlined"
            color={statusColors[status]}
            icon={statusIcons[status]}
            label={t(`sa_status_${status}`)}
            sx={{ height: 24, borderRadius: '12px', fontWeight: 500 }}
        />
    );
}

export function Card(props: {
    children: React.ReactNode;
    sx?: SxProps<Theme>;
    onClick?: () => void;
}): React.JSX.Element {
    return (
        <Paper
            elevation={1}
            onClick={props.onClick}
            sx={{
                p: 2,
                borderRadius: 1,
                cursor: props.onClick ? 'pointer' : undefined,
                ...(props.sx || {}),
            }}
        >
            {props.children}
        </Paper>
    );
}

export function SectionTitle(props: { children: React.ReactNode }): React.JSX.Element {
    return <Typography sx={{ fontSize: 16, fontWeight: 500, mb: 1.5 }}>{props.children}</Typography>;
}

export const tabular: SxProps<Theme> = { fontVariantNumeric: 'tabular-nums' };
