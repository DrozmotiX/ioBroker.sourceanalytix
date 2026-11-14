// Copy the built custom components to admin/custom (loaded by admin/jsonConfig.json)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const target = '../admin/custom';
if (existsSync(target)) {
    rmSync(target, { recursive: true });
}
mkdirSync(`${target}/i18n`, { recursive: true });
cpSync('build/customComponents.js', `${target}/customComponents.js`);
if (existsSync('build/assets')) {
    cpSync('build/assets', `${target}/assets`, { recursive: true });
}
cpSync('src/i18n', `${target}/i18n`, { recursive: true });
// Languages without own translation fall back to English until they are translated
for (const lang of ['es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn']) {
    if (!existsSync(`src/i18n/${lang}.json`)) {
        cpSync('src/i18n/en.json', `${target}/i18n/${lang}.json`);
    }
}
console.log(`Copied custom components to ${target}`);
