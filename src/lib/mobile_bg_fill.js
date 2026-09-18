// This file is injected verbatim into a Mobile.bg page, as an extension file, a
// userscript body, or a console paste. It is plain JavaScript on purpose: it
// must not be transpiled or wrapped, and it must not reference anything outside
// itself. Do not add imports here.
//
// It fills the form and stops. Submitting is left to the person, because the
// listing carries their phone number and their Mobile.bg reputation.

function fillMobileBgForm(steps, extras) {
  var sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };

  function normalize(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').toLocaleLowerCase('bg');
  }

  function byName(name) {
    return document.querySelector('[name="' + name + '"]');
  }

  function panel(text) {
    var node = document.getElementById('aicc-report');
    if (!node) {
      node = document.createElement('div');
      node.id = 'aicc-report';
      node.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;max-height:60vh;overflow:auto;padding:12px 14px;border-radius:10px;background:#0f172a;color:#e2e8f0;font:12px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);white-space:pre-wrap';
      document.body.appendChild(node);
    }
    node.textContent = text;
  }

  // «Марка» reloads «Модел», and «Област» reloads «Държава». A fixed sleep loses
  // that race and every dependent list is reported as "no matching option" while
  // the form sits half-empty, so wait for the options to be there instead.
  function waitForOptions(select, minimum, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 10000);
    return new Promise(function (resolve) {
      (function check() {
        if (select.options.length >= (minimum || 2)) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(check, 250);
      })();
    });
  }

  // React-driven inputs ignore a plain assignment, so the native setter is used
  // and the events the page listens for are dispatched afterwards. The prototype
  // is walked rather than tested with instanceof: this code runs in the
  // extension's isolated world, where instanceof against the page's element
  // returns false and the wrong setter would be picked for a textarea.
  function setNativeValue(element, value) {
    var proto = Object.getPrototypeOf(element);
    var descriptor = null;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (!descriptor || !descriptor.set) {
        descriptor = null;
        proto = Object.getPrototypeOf(proto);
      }
    }
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectByText(select, wanted) {
    return waitForOptions(select).then(function (ready) {
      if (!ready) return false;
      var target = normalize(wanted);
      var option = Array.prototype.slice.call(select.options).find(function (candidate) {
        return normalize(candidate.textContent) === target;
      });
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
  }

  // «Заглавие» is not one of the named f-fields, so it is found by its visible
  // label rather than by guessing a control name.
  function findTitleInput() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('label, td, b, strong'));
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (normalize(node.textContent) !== 'заглавие') continue;
      var forId = node.getAttribute && node.getAttribute('for');
      if (forId) {
        var linked = document.getElementById(forId);
        if (linked) return linked;
      }
      var nested = node.querySelector('input, textarea');
      if (nested) return nested;
      var sibling = node.parentElement && node.parentElement.querySelector('input, textarea');
      if (sibling) return sibling;
    }
    return null;
  }

  function findCheckboxByLabel(text) {
    var target = normalize(text);
    var labels = Array.prototype.slice.call(document.querySelectorAll('label'));
    for (var i = 0; i < labels.length; i += 1) {
      var label = labels[i];
      if (normalize(label.textContent) !== target) continue;
      var nested = label.querySelector('input[type="checkbox"]');
      if (nested) return nested;
      var forId = label.getAttribute('for');
      if (forId) {
        var linked = document.getElementById(forId);
        if (linked) return linked;
      }
    }
    return null;
  }

  var report = { filled: [], skipped: [] };

  if (!byName('f5')) {
    report.error = 'Формата не е намерена. Отвори формата за нова обява и влез в профила си, после опитай пак.';
    panel(report.error);
    return Promise.resolve(report);
  }

  var total = steps.length + extras.length;

  async function run() {
    panel('Попълвам… 0/' + total);

    for (var i = 0; i < steps.length; i += 1) {
      var step = steps[i];
      try {
        if (step.label === 'title') {
          var titleInput = findTitleInput();
          if (!titleInput) {
            report.skipped.push([step.label, 'Полето не е намерено']);
          } else {
            setNativeValue(titleInput, step.value);
            report.filled.push(step.label);
          }
        } else {
          var control = byName(step.selector);
          if (!control) {
            report.skipped.push([step.label, 'Полето липсва']);
          } else if (step.kind === 'select') {
            var chosen = await selectByText(control, step.value);
            if (!chosen) {
              report.skipped.push([step.label, 'Няма опция „' + step.value + '“']);
            } else {
              report.filled.push(step.label);
              // The dependent lists reload after these three.
              if (step.label === 'make' || step.label === 'location' || step.label === 'country') {
                await sleep(600);
              }
            }
          } else {
            setNativeValue(control, step.value);
            report.filled.push(step.label);
          }
        }
      } catch (error) {
        report.skipped.push([step.label, String((error && error.message) || error)]);
      }
      panel('Попълвам… ' + (report.filled.length + report.skipped.length) + '/' + total);
    }

    for (var j = 0; j < extras.length; j += 1) {
      var label = extras[j];
      try {
        var box = findCheckboxByLabel(label);
        if (!box) {
          report.skipped.push(['екстра: ' + label, 'Няма такъв екстра']);
        } else {
          if (!box.checked) box.click();
          report.filled.push('екстра: ' + label);
        }
      } catch (error) {
        report.skipped.push(['екстра: ' + label, String((error && error.message) || error)]);
      }
      panel('Попълвам… ' + (report.filled.length + report.skipped.length) + '/' + total);
    }

    var lines = ['Попълнени: ' + report.filled.length + ' от ' + total];
    if (report.skipped.length) {
      lines.push('', 'Пропуснати (' + report.skipped.length + '):');
      for (var k = 0; k < report.skipped.length && k < 10; k += 1) {
        lines.push('  ' + report.skipped[k][0] + ' — ' + report.skipped[k][1]);
      }
    }
    lines.push('', 'Провери стойностите и натисни «Продължи» сам.');
    panel(lines.join('\n'));
    return report;
  }

  return run();
}