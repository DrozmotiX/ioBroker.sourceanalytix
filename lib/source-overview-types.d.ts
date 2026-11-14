// Types of the source overview of the settings page (#1269), see lib/source-overview.js

declare global {
	/** Finding of the configuration check of a source */
	interface SaFinding {
		code: string;
		severity: string;
	}

	/** One source (or output folder without datapoint) as shown on the settings page */
	interface SaSourceSummary {
		id: string;
		name: string;
		orphan?: boolean;
		enabled: boolean;
		active: boolean;
		sourceExists: boolean;
		sourceUnit?: string | null;
		unit?: string | null;
		calcUnit?: string | null;
		kind?: string;
		priceDefinition?: string | null;
		costType?: string | null;
		basicRate?: boolean;
		resetDetection?: boolean;
		outputId: string;
		cumulative?: number | null;
		valueAtDeviceReset?: number | null;
		pendingRealign?: boolean;
		pendingMeterSwap?: boolean;
		decreasesWhileResetOff?: number;
		valueType?: string | null;
		lastValue?: ioBroker.StateValue | null;
		lastValueTs?: number | null;
		lastUpdate?: number | null;
		periodDate?: string | null;
		values: Record<string, { quantity: number | null; money: number | null }>;
		settings: Record<string, unknown>;
		diagnostics: SaFinding[];
		status?: string;
	}

	/** Entry of the problem list */
	interface SaProblem {
		id: string;
		source: string;
		name: string;
		code: string;
		severity: string;
		[key: string]: unknown;
	}

	/** Error of a start value */
	interface SaStartValueError {
		code: string;
		suggestion?: number;
		other?: string;
		otherValue?: number;
	}
}

export {};
