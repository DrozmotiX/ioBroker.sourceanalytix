import config from "@iobroker/eslint-config";

export default [
	...config,
	{
		ignores: [
			".dev-server/",
			".vscode/",
			".claude/",
			"test/**/*.js",
			"admin/admin.d.ts",
			"admin/custom/",
			"src-admin/",
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
