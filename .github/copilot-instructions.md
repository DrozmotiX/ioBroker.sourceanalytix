# ioBroker SourceAnalytix Development Instructions

**ALWAYS follow these instructions first and only fallback to additional search or bash commands when the information here is incomplete or found to be in error.**

ioBroker SourceAnalytix is a Node.js adapter for the ioBroker home automation platform that provides detailed energy, gas, and liquid consumption analysis. The adapter calculates consumption statistics, costs, and generates reports with weekly, monthly, quarterly, and yearly breakdowns.

## Working Effectively

### Initial Setup and Dependencies
- **NEVER CANCEL**: Dependency installation takes ~21 seconds. Use timeout 60+ seconds.
- `npm install` -- installs all dependencies including dev tools, testing framework, and build tools
- The build uses Node.js with JavaScript ES6+, ESLint for linting, and Mocha for testing

### Build and Linting
- `npm run lint` -- runs ESLint code style and quality checks (~5 seconds)
- `npx gulp default` -- runs default gulp tasks (updatePackages, updateReadme) (~5 seconds)
- `npx tsc --noEmit` -- TypeScript type checking (has expected errors that don't affect functionality)

### Testing
- **NEVER CANCEL**: Test suite takes ~60 seconds. Use timeout 120+ seconds.
- **IMPORTANT**: `npm test` fails due to deprecated mocha.opts configuration
- **Use instead**: `npx mocha --require test/mocha.setup.js test/unit.js test/integration.js test/package.js`
- Alternative individual test commands:
  - `npm run test:unit` -- unit tests (~1 second)
  - `npm run test:integration` -- integration tests (~25 seconds)
  - `npm run test:package` -- package validation (~1 second)
- Tests include adapter startup, integration tests with Redis backend, and package validation
- Tests create temporary ioBroker environment in `/tmp/test-iobroker.sourceanalytix/`
- Test logs show "Successfully activated SourceAnalytix" when adapter starts correctly

### Development Environment
- Main adapter code: `main.js` (entry point)
- Library functions: `lib/tools.js`
- Admin interface: `admin/index_m.html` (Material UI)
- Configuration: `io-package.json` (adapter metadata), `package.json` (npm config)
- Linting config: `.eslintrc.json`
- TypeScript config: `tsconfig.json`, `tsconfig.check.json`

## Complete Validation Workflow

When making changes to the codebase, follow this exact sequence:

```bash
# Step 1: Install dependencies (if package.json changed)
npm install  # Takes ~21 seconds, use 60+ second timeout

# Step 2: Lint code
npm run lint  # Must pass for CI to succeed

# Step 3: Run tests
npx mocha --require test/mocha.setup.js test/unit.js test/integration.js test/package.js
# Takes ~60 seconds, use 120+ second timeout
# Should show "40 passing" and "Successfully activated SourceAnalytix"

# Step 4: Type checking (optional, has expected errors)
npx tsc --noEmit  # Will show errors but they don't affect functionality

# Step 5: Build tasks (if admin interface changed)
npx gulp adminWords2languages  # Updates translations
```

## Validation

### Required Validation Steps
- ALWAYS run `npm install` first after making any package.json changes
- ALWAYS run `npm run lint` before committing - the CI will fail without clean lint
- **IMPORTANT**: DO NOT use `npm test` (fails due to deprecated mocha.opts)
- **Use instead**: `npx mocha --require test/mocha.setup.js test/unit.js test/integration.js test/package.js`
- Alternative: `npm run test:unit && npm run test:integration && npm run test:package`
- Test the adapter startup process - logs should show "Successfully activated SourceAnalytix"
- Verify admin interface loads correctly (check admin/index_m.html syntax)

### Manual Testing Scenarios
- **Adapter Startup**: Run tests and verify logs show "Successfully activated SourceAnalytix for all 0 of 0 states"
- **Configuration Loading**: Check that price definitions are loaded correctly in adapter logs
- **Admin Interface**: Verify admin/index_m.html contains valid HTML structure
- **Unit Calculations**: Confirm unit config contains proper category mappings (Watt, Watt_hour, Liter, Cubic_meter)
- **Price Definitions**: Validate all price categories (ElectricityDay, Gas, Water, etc.) are properly structured
- **Test Environment**: Integration tests create a complete ioBroker environment in `/tmp/test-iobroker.sourceanalytix/`
- **Error Validation**: `npm test` should fail with "configuring Mocha via 'mocha.opts' is DEPRECATED" message

### CI/CD Validation
- Always run linting: GitHub Actions workflow requires lint to pass
- The CI runs on Node.js 16.x, 18.x, 20.x on Ubuntu, Windows, and macOS
- Tests must pass on all supported platforms
- Sentry error reporting is enabled - avoid breaking changes that cause runtime errors

## Common Tasks

### Working with Price Definitions
- Price configs are stored in `io-package.json` under `native.pricesDefinition`
- Categories include: ElectricityDay, ElectricityNight, ElectricityDelivery, Gas, Oil, Water, Heatpump
- Each price definition has: category, description, cost type (costs/earnings), unit type, price per unit, price per month

### Admin Interface Development
- Admin UI uses Material Design (`admin/index_m.html`)
- Translations handled via `admin/words.js`
- Style definitions in `admin/style.css`
- Use `npx gulp adminWords2languages` to update translations after text changes

### Code Structure Understanding
- `main.js`: Core adapter logic, state management, calculation engine
- `lib/tools.js`: Utility functions for translations and HTTP requests
- Admin files: Configuration interface and user settings
- Test files: Unit tests (deprecated), integration tests, package validation

### Working with States and Calculations
- States are configured through the admin interface
- Calculation types: costs, earnings, consumption, counter values
- Units supported: Watt/Wh/kWh for electricity, l/m³ for liquids/gas
- Transformations handle unit conversions (W to kWh, etc.)

### Debugging and Troubleshooting
- Enable debug logging in adapter configuration
- Check ioBroker logs for state initialization errors
- Verify price definitions exist for configured calculation types
- Ensure cumulative reading values are logical (not negative, not decreasing unexpectedly)

## Important Notes

### Dependencies and Compatibility
- Requires Node.js (tested on 16.x, 18.x, 20.x)
- Requires js-controller >= 3.3.0
- Uses @iobroker/adapter-core for base functionality
- Sentry.io integration for error reporting

### File Structure Reference
```
├── main.js                 # Main adapter entry point
├── lib/
│   └── tools.js           # Utility functions
├── admin/                 # Admin interface
│   ├── index_m.html       # Main admin page
│   ├── words.js           # Translations
│   └── style.css          # Styling
├── test/                  # Test files
│   ├── integration.js     # Integration tests
│   ├── unit.js           # Unit tests
│   └── package.js        # Package validation
├── package.json          # NPM configuration
├── io-package.json       # ioBroker adapter metadata
├── gulpfile.js           # Build automation
└── .eslintrc.json        # ESLint configuration
```

### Known Issues and Workarounds
- **CRITICAL**: `npm test` fails due to deprecated mocha.opts - use alternative command instead:
  `npx mocha --require test/mocha.setup.js test/unit.js test/integration.js test/package.js`
- TypeScript type checking reports errors in dependencies that don't affect functionality
- Some npm audit warnings exist in dependencies - these don't impact adapter functionality
- Adapter requires Redis backend for integration tests (automatically provided by test framework)

### Performance Expectations (Based on Validation)
- npm install: ~21 seconds (NEVER CANCEL - use 60+ second timeout)
- Linting: ~0.5 seconds  
- Full test suite: ~60 seconds (NEVER CANCEL - use 120+ second timeout)
- Individual tests: unit (~1s), integration (~25s), package (~1s)
- Type checking: ~4 seconds
- Gulp tasks: <1 second

Always use timeouts of at least double these durations when running commands programmatically.

## Critical Validation Notes

### Test Execution Details
- Integration tests automatically install ioBroker environment and Redis backend
- Tests verify adapter can start successfully and show proper initialization
- Unit tests show "DEPRECATED!" warning but this is expected for legacy compatibility
- Package tests validate all required metadata in package.json and io-package.json
- Full test run shows "40 passing" when successful

### Error Conditions to Expect
- `npm test` will always fail with mocha.opts deprecation error - this is correct behavior
- TypeScript checking shows 14 errors in dependencies - these don't affect functionality
- npm audit shows vulnerabilities in dependencies - these don't impact adapter functionality
- Integration tests may show npm warnings about production/dev dependencies - these are harmless