// Renders the real page component and asserts against the rendered markup,
// so an import or type error in the page cannot pass unnoticed.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CanadaCatalog } from '@/pages/CanadaCatalog';

const html = renderToStaticMarkup(createElement(CanadaCatalog));

let pass = 0, fail = 0;
const ck = (l, c, x = '') => c ? (pass++, console.log('  ok   ' + l)) : (fail++, console.log('  FAIL ' + l + (x ? ' — ' + x : '')));

const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

ck('рендерира се без грешка', html.length > 5000, String(html.length));
ck('заглавие «Канада каталог»', text.includes('Канада каталог'));
ck('общ брой 405', text.includes('405'));
ck('KPI «С канадска цена»', text.includes('С канадска цена'));
ck('KPI «Канада по-ниска»', text.includes('Канада по-ниска'));
ck('KPI «Без българска цена»', text.includes('Без българска цена'));
ck('KPI «Публикувани»', text.includes('Публикувани'));
ck('филтър Марка', text.includes('Марка'));
ck('филтър Сравнение', text.includes('Сравнение'));
ck('колона Канада (AutoTrader)', text.includes('Канада (AutoTrader)'));
ck('колона България (Mobile.bg)', text.includes('България (Mobile.bg)'));
ck('показва 10 реда на страница', (html.match(/<tr/g) || []).length >= 10, String((html.match(/<tr/g) || []).length));
ck('първите редове са Audi Q3', text.includes('Audi') && text.includes('Q3'));
ck('има AutoTrader линкове', (html.match(/autotrader\.ca/g) || []).length > 0);
ck('има Mobile.bg линкове', (html.match(/mobile\.bg/g) || []).length > 0);
ck('пагинация «Показани»', text.includes('Показани'));
ck('легенда за оцветяване', text.includes('Оцветяване на крайната цена'));
ck('EUR формат присъства', html.includes('€'));
ck('CAD стойности присъстват', text.includes('CAD'));
ck('линковете са с noopener', (html.match(/noopener/g) || []).length > 0);
ck('всички външни линкове са target=_blank', !/<a (?![^>]*target="_blank")[^>]*href="https?:/.test(html));
ck('няма null в изхода', !/>null</.test(html) && !text.includes(' null '), 'намерено null');
ck('няма undefined в изхода', !html.includes('undefined'));

console.log(`\n${pass} успешни, ${fail} неуспешни`);
process.exit(fail ? 1 : 0);
