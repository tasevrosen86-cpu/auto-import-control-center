/* Korean Calculator — standalone web port of bg.koreacalc MainActivity.java.
   Same customs/transport/commission table and same final formula as the APK.
   The live QuoteMaster lookup is replaced by the fixed rate from AGENTS.md. */
(function () {
  'use strict';

  var COMMISSION = 1350;
  var KRW_PER_EUR = 1454.55;

  var statusEl = document.getElementById('status');
  var errorDiv = document.getElementById('error');
  var resultDiv = document.getElementById('result');
  var yearSelect = document.getElementById('year');
  var typeSelect = document.getElementById('type');
  var krwInput = document.getElementById('krw');
  var form = document.getElementById('calcForm');

  var currentYear = new Date().getFullYear();
  var years = [];
  for (var y = currentYear; y >= 2010; y--) { years.push(y); }
  yearSelect.innerHTML = years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
  yearSelect.value = '2024';

  var numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, minimumFractionDigits: 0 });

  function parseKrw(raw) {
    var s = String(raw).trim();
    if (!s) { throw new Error('Въведи цена в KRW.'); }
    var digits = s.replace(/\D/g, '');
    if (!digits || Number(digits) === 0) { throw new Error('Въведи валидна цена в KRW.'); }
    return Number(digits);
  }

  // === APK customsAndVat(int year, int type) — one-to-one ===
  function customsAndVat(year, type) {
    var isSedan = (type === 0);
    if (isSedan) {
      if (year <= 2016) { return 1200; }
      if (year <= 2018) { return 1400; }
      if (year <= 2020) { return 1500; }
      if (year <= 2022) { return 1600; }
      return (year <= 2024) ? 1700 : 1800;
    }
    if (year <= 2016) { return 1200; }
    if (year <= 2017) { return 1500; }
    if (year <= 2019) { return 1800; }
    if (year <= 2021) { return 2000; }
    if (year <= 2023) { return 2200; }
    return (year <= 2025) ? 2400 : 2600;
  }

  // === APK: int transport = type == 0 ? 1000 : type == 1 ? 1100 : 1200; ===
  function transportFor(type) {
    if (type === 0) { return 1000; }
    if (type === 1) { return 1100; }
    return 1200;
  }

  function formatNumber(n) {
    return numberFormat.format(Math.round(n));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorDiv.textContent = '';
    var krw;
    try {
      krw = parseKrw(krwInput.value);
    } catch (err) {
      errorDiv.textContent = err.message;
      resultDiv.hidden = true;
      return;
    }

    // Calibrated against the built-in rate: 33 900 000 KRW → 23 306 EUR.
    var eur = Math.floor(krw / KRW_PER_EUR);
    var year = parseInt(yearSelect.value, 10);
    var type = parseInt(typeSelect.value, 10);

    var customs;
    if (eur > 40000) {
      customs = Math.round(eur * 0.10);
    } else {
      customs = customsAndVat(year, type);
    }
    var transport = transportFor(type);
    var total = customs + eur + COMMISSION + transport;

    var customsLabel = 'Мито и ДДС: +' + formatNumber(customs) + ' €';
    if (eur > 40000) { customsLabel += ' (10% от стойността)'; }

    resultDiv.hidden = false;
    resultDiv.innerHTML =
      'Стойност: ' + formatNumber(eur) + ' € (курс ' + KRW_PER_EUR + ')\n' +
      customsLabel + '\n' +
      'Комисиона: +1.350 €\n' +
      'Автовоз: +' + formatNumber(transport) + ' €\n' +
      '\n' +
      '<div class="total">КРАЙНА ЦЕНА: ' + formatNumber(total) + ' €</div>';
    statusEl.textContent = 'Готово.';
  });
})();
