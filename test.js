/* eslint-disable no-undef */
// Please enter the state ID which must be converted
const convertStates = [
	'zigbee.0.group_1'
];

// *****************************************
// *** Do not adjust anything below here ***
// *****************************************

// Prepare variables
const mySubscription = {};
const stateDetails = {};
const timeOut = {};
const hexCharacters = 'a-f\\d';
const match3or4Hex = `#?[${hexCharacters}]{3}[${hexCharacters}]?`;
const match6or8Hex = `#?[${hexCharacters}]{6}([${hexCharacters}]{2})?`;
const nonHexChars = new RegExp(`[^#${hexCharacters}]`, 'gi');
const validHexSize = new RegExp(`^${match3or4Hex}$|^${match6or8Hex}$`, 'i');

// Read all array objects, create new state in javascript instance and subscribe on changes
for (const hexValues in convertStates) {
	const stateName = `HexRGB.${convertStates[hexValues].split('.').join('__')}`;
	const stateNameHex = `${convertStates[hexValues]}`;

	// Create State to handle convertion in RGB
	// @ts-ignore
	createState(`${stateName}.rgb`, {
		'name': `RGB Value of ${stateName}`,
		'role': 'level.color.rgb',
		'type': 'array'
	});
	// Create State to handle convertion in RGB
	// @ts-ignore
	createState(`${stateName}.hue`, {
		'name': `Hue of`,
		'role': 'level.color.hue',
		'type': 'number'
	});
	// Create State to handle convertion in RGB
	// @ts-ignore
	createState(`${stateName}.sat`, {
		'name': `Sat`,
		'role': 'level.color.sat',
		'type': 'number'
	});

	// Prepare memory items used by rountime
	stateDetails[`${stateName}.rgb`] = {
		'blockChanges': true
	};
	// Prepare memory items used by rountime
	stateDetails[`${stateName}.hue`] = {
		'blockChanges': true
	};
	// Prepare memory items used by rountime
	stateDetails[`${stateName}.sat`] = {
		'blockChanges': true
	};
	stateDetails[`${stateNameHex}.color`] = {
		'blockChanges': true
	};

	ignoreTimer(`${stateNameHex}.color`, stateName);

	// Subscribe on state changes of HEX source state
	// @ts-ignore
	mySubscription[`${stateNameHex}.color`] = on({ id: `${stateNameHex}.color`, change: 'ne', ack: false }, (data) => {
		if (stateDetails[`${stateNameHex}.color`].blockChanges !== true) {
			const rgbValue = hexToRGB(data['newState'].val);
			// log(`Convert ${`${stateNameHex}.color`} HEX : ${data['newState'].val} to RGB value ${rgbValue}`);
			ignoreTimer(`${stateNameHex}.color`, stateName);
			// @ts-ignore
			setState(`${stateName}.rgb`, { val: rgbValue, ack: true });
			// @ts-ignore
			hexToHSL('#' + data['newState'].val, `javascript.${instance}.${stateName}`);
			// console.log('#'+ data['newState'].val)
			// console.log(JSON.stringify('Hex to HSL' + hexToHSL('#'+ data['newState'].val, `javascript.${instance}.${stateName}` )));
		}
	});

	// Subscribe on state changes of converted RGB value
	// @ts-ignore
	mySubscription[stateName] = on({ id: `javascript.${instance}.${stateName}.rgb`, change: 'ne' }, (data) => {
		console.log(`RGB change value : ${data['newState'].val}`);
		const hexValue = RGBToHEX(data['newState'].val);
		if (stateDetails[`${stateName}.rgb`].blockChanges !== true) {
			// @ts-ignore
			log(`Convert ${stateName} RGB : ${data['newState'].val} to HEX value ${hexValue}`);
			// @ts-ignore
			const hue = getState(`${stateName}.hue`);
			// @ts-ignore
			const sat = getState(`${stateName}.sat`);
			console.log(`Hue ${hue.val} SAT ${sat.val}`);
			ignoreTimer(`${stateNameHex}.color`, stateName);
			// @ts-ignore
			setState(`${stateNameHex}.color`, { val: hexValue });
			// @ts-ignore
			hexToHSL('#' + hexValue, `javascript.${instance}.${stateName}`);


			// HSLToHex(hue.val, sat.val, '100', `${stateNameHex}.color`);

		}

	});

	// Subscribe on state changes of converted hue value
	// @ts-ignore
	mySubscription[`${stateName}.hue`] = on({ id: `javascript.${instance}.${stateName}.hue`, change: 'ne' }, (data) => {
		console.log(`Hue change detected : ${data['newState'].val}`);
		// const hexValue = RGBToHEX(data['newState'].val);
		if (stateDetails[`${stateName}.hue`].blockChanges !== true) {
			// log(`Convert ${stateName} RGB : ${data['newState'].val} to HEX value ${hexValue}`);
			// @ts-ignore
			const hue = getState(`${stateName}.hue`);
			// @ts-ignore
			const sat = getState(`${stateName}.sat`);
			// @ts-ignore
			const brightness = getState(`${stateNameHex}.brightness`);
			console.log(`Hue ${hue.val} SAT ${sat.val} brightness ${brightness.val}`);
			ignoreTimer(`${stateNameHex}.color`, stateName);

			// console.log(`${hslToHex(hue.val,sat.val,brightness.val)}`)
			// @ts-ignore
			setState(`${stateNameHex}.color`, { val: hslToHex(hue.val, sat.val, brightness.val) });
		}

	});

	// Subscribe on state changes of converted hue value
	// @ts-ignore
	mySubscription[`${stateName}.sat`] = on({ id: `javascript.${instance}.${stateName}.sat`, change: 'ne' }, (data) => {
		console.log(`Sata change detected : ${data['newState'].val}`);
		// const hexValue = RGBToHEX(data['newState'].val);
		if (stateDetails[`${stateName}.sat`].blockChanges !== true) {
			// log(`Convert ${stateName} RGB : ${data['newState'].val} to HEX value ${hexValue}`);
			// @ts-ignore
			const hue = getState(`${stateName}.hue`);
			// @ts-ignore
			const sat = getState(`${stateName}.sat`);
			// @ts-ignore
			const brightness = getState(`${stateNameHex}.brightness`);
			console.log(`Hue ${hue.val} SAT ${sat.val} brightness ${brightness.val}`);
			ignoreTimer(`${stateNameHex}.color`, stateName);

			// console.log(`${hslToHex(hue.val,sat.val,brightness.val)}`)
			// @ts-ignore
			setState(`${stateNameHex}.color`, { val: hslToHex(hue.val, sat.val, brightness.val) });
		}

	});


	// Subscribe on state changes of converted RGB value

}

// Function to set variable to avoid loop actions in script
function ignoreTimer(stateNameHex, stateName) {

	stateDetails[stateNameHex].blockChanges = true;
	stateDetails[`${stateName}.sat`].blockChanges = true;
	stateDetails[`${stateName}.hue`].blockChanges = true;
	stateDetails[`${stateName}.rgb`].blockChanges = true;

	// Delete block after 500ms
	if (timeOut[stateName]) { clearTimeout(timeOut[stateName]); timeOut[stateName] = null; }
	timeOut[stateName] = setTimeout(function () {
		stateDetails[stateNameHex].blockChanges = false;
		stateDetails[`${stateName}.sat`].blockChanges = false;
		stateDetails[`${stateName}.hue`].blockChanges = false;
		stateDetails[`${stateName}.rgb`].blockChanges = false;
	}, 500);
}

// Convert HEX values to RGB https://github.com/sindresorhus/hex-rgb#readme
// @ts-ignore
function hexToRGB(hex) {
	if (typeof hex !== 'string' || nonHexChars.test(hex) || !validHexSize.test(hex)) {
		throw new TypeError('Expected a valid hex string');
	}

	hex = hex.replace(/^#/, '');
	// let alpha = 1;

	if (hex.length === 8) {
		// alpha = parseInt(hex.slice(6, 8), 16) / 255;
		hex = hex.slice(0, 6);
	}

	if (hex.length === 4) {
		// alpha = parseInt(hex.slice(3, 4).repeat(2), 16) / 255;
		hex = hex.slice(0, 3);
	}

	if (hex.length === 3) {
		hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	}

	const num = parseInt(hex, 16);
	const red = num >> 16;
	const green = (num >> 8) & 255;
	const blue = num & 255;

	return [red, green, blue];
}

// Convert RGB values to HEX https://github.com/sindresorhus/rgb-hex
function RGBToHEX(red, green, blue, alpha) {
	const isPercent = (red + (alpha || '')).toString().includes('%');

	if (typeof red === 'string') {
		// @ts-ignore
		[red, green, blue, alpha] = red.match(/(0?\.?\d{1,3})%?\b/g).map(Number);
	} else if (alpha !== undefined) {
		alpha = parseFloat(alpha);
	}

	if (typeof red !== 'number' ||
        typeof green !== 'number' ||
        typeof blue !== 'number' ||
        red > 255 ||
        green > 255 ||
        blue > 255
	) {
		// throw new TypeError('Expected three numbers below 256');
	}

	if (typeof alpha === 'number') {
		if (!isPercent && alpha >= 0 && alpha <= 1) {
			alpha = Math.round(255 * alpha);
		} else if (isPercent && alpha >= 0 && alpha <= 100) {
			alpha = Math.round(255 * alpha / 100);
		} else {
			throw new TypeError(`Expected alpha value (${alpha}) as a fraction or percentage`);
		}

		alpha = (alpha | 1 << 8).toString(16).slice(1);
	} else {
		alpha = '';
	}

	return ((blue | green << 8 | red << 16) | 1 << 24).toString(16).slice(1) + alpha;
}

function hexToHSL(H, stateName) {
	// Convert hex to RGB first
	let r = 0, g = 0, b = 0;
	if (H.length == 4) {
		// @ts-ignore
		r = '0x' + H[1] + H[1];
		// @ts-ignore
		g = '0x' + H[2] + H[2];
		// @ts-ignore
		b = '0x' + H[3] + H[3];
	} else if (H.length == 7) {
		// @ts-ignore
		r = '0x' + H[1] + H[2];
		// @ts-ignore
		g = '0x' + H[3] + H[4];
		// @ts-ignore
		b = '0x' + H[5] + H[6];
	}
	// Then to HSL
	r /= 255;
	g /= 255;
	b /= 255;
	let cmin = Math.min(r, g, b),
		cmax = Math.max(r, g, b),
		delta = cmax - cmin,
		h = 0,
		s = 0,
		l = 0;

	if (delta == 0)
		h = 0;
	else if (cmax == r)
		h = ((g - b) / delta) % 6;
	else if (cmax == g)
		h = (b - r) / delta + 2;
	else
		h = (r - g) / delta + 4;

	h = Math.round(h * 60);

	if (h < 0)
		h += 360;

	l = (cmax + cmin) / 2;
	s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
	s = +(s * 100).toFixed(1);
	l = +(l * 100).toFixed(1);
	console.log(h);
	console.log(Math.round((s / 100 * 255)));
	// @ts-ignore
	setState(`${stateName}.sat`, { val: Math.round((s)), ack: true });
	// @ts-ignore
	setState(`${stateName}.hue`, { val: h, ack: true });
	return h + ',' + Math.round((s / 100 * 255)) + ',' + Math.round(l / 100 * 255);
}

function hslToHex(h, s, l) {
	h /= 360;
	s /= 100;
	l /= 100;
	let r, g, b;
	if (s === 0) {
		r = g = b = l; // achromatic
	} else {
		const hue2rgb = (p, q, t) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}
	const toHex = x => {
		const hex = Math.round(x * 255).toString(16);
		return hex.length === 1 ? '0' + hex : hex;
	};
	return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}