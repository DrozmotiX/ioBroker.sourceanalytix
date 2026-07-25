import config from "@iobroker/eslint-config";

export default [
	...config,
	{
		ignores: [
			".dev-server/",
			".vscode/",
			"*.test.js",
			"test/**/*.js",
			"admin/admin.d.ts",
			"**/adapter-config.d.ts",
		],
	},
	{
		rules: {
			curly: "off",
			"jsdoc/tag-lines": "off",
			"prettier/prettier": "off",
			"prefer-template": "off",
		},
	},
];
