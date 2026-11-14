import React from 'react';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

import SourcesApp from './SourcesApp';

/** Custom jsonConfig component of the tab "Übersicht" (#1269) */
export default class SourcesOverview extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
    renderItem(): React.JSX.Element {
        return (
            <SourcesApp
                view="overview"
                themeName={this.props.themeName}
                api={{
                    socket: this.props.oContext.socket,
                    instance: this.props.oContext.instance,
                    adapterName: this.props.oContext.adapterName,
                    themeType: this.props.oContext.themeType,
                    theme: this.props.oContext.theme,
                }}
            />
        );
    }
}
