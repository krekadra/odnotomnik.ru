(() => {
  'use strict';

  const ROOT_ID = 'odnotomnik-orders-extension';
  const TABLE_SELECTOR = 'table.table';
  const MODAL_SELECTOR = '#order-view-modal';
  const DETAIL_TIMEOUT_MS = 8000;

  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function quantitySummary(cell) {
    const items = [...cell.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => clean(node.textContent))
      .filter(Boolean);
    const counts = new Map();
    items.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  function getOrders(table) {
    return [...table.rows].slice(1).map((row, index) => {
      const cells = [...row.cells];
      const detailLink = [...row.querySelectorAll('a')].find((link) => clean(link.textContent) === 'Подробнее');
      const paymentLink = [...row.querySelectorAll('a')].find((link) => clean(link.textContent).startsWith('Оплатить'));
      return {
        index,
        row,
        number: clean(cells[0]?.textContent),
        date: clean(cells[1]?.textContent),
        products: quantitySummary(cells[2] || document.createElement('td')),
        comment: clean(cells[3]?.textContent),
        total: clean(cells[4]?.textContent),
        status: clean(cells[5]?.textContent),
        paid: clean(cells[6]?.textContent).includes('Оплачен'),
        paymentUrl: paymentLink?.href,
        detailLink,
        specification: null,
      };
    });
  }

  function textLines(root) {
    // Product characteristics are text inside a <span> separated by <br> tags.
    // Looking only at leaf elements drops that whole span because <br> is a child.
    return (root.innerText || '')
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);
  }

  function parseSpecification(modal) {
    const lines = textLines(modal);
    const projects = [];
    let project = null;

    for (const line of lines) {
      if (line === 'Проект с групповыми параметрами') {
        if (project) projects.push(project);
        project = { title: '', fields: {} };
        continue;
      }
      if (!project) continue;
      const separator = line.indexOf(':');
      if (separator > 0) {
        project.fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
      } else if (!project.title && !/^\d/.test(line)) {
        project.title = line.replace(/\s+1 шт\.?$/, '');
      }
    }
    if (project) projects.push(project);

    return projects.map((item) => ({
      title: item.title || item.fields['Тип фотокниги'] || 'Фотокнига',
      quantity: item.fields['Количество книг'] || '—',
      format: item.fields['Формат'] || '—',
      cover: item.fields['Обложка'] || '—',
      paper: item.fields['Бумага'] || '—',
      protection: item.fields['Дополнительная защита листов'] || '—',
      spreads: item.fields['Развороты'] || '—',
    }));
  }

  function waitForModal() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        const modal = document.querySelector(`${MODAL_SELECTOR}.is-active`);
        if (modal && textLines(modal).some((line) => line === 'Проект с групповыми параметрами')) {
          window.clearInterval(timer);
          resolve(modal);
        } else if (Date.now() - started > DETAIL_TIMEOUT_MS) {
          window.clearInterval(timer);
          reject(new Error('Не удалось получить спецификацию'));
        }
      }, 80);
    });
  }

  async function loadSpecification(order) {
    if (!order.detailLink) return [];
    order.detailLink.click();
    const modal = await waitForModal();
    const specification = parseSpecification(modal);
    modal.querySelector('.modal-close, .delete, button')?.click();
    return specification;
  }

  function productsHtml(products) {
    return products.map(({ name, count }) => `
      <li><span>${escapeHtml(name)}</span><b>×${count}</b></li>`).join('');
  }

  function specificationHtml(specification) {
    if (!specification) return '<p class="oto-loading">Загружаю состав печати…</p>';
    if (!specification.length) return '<p class="oto-muted">Спецификация недоступна.</p>';
    return specification.map((item) => `
      <section class="oto-spec">
        <div class="oto-spec-title"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.quantity)} шт.</span></div>
        <div class="oto-facts"><span><b>Формат</b>${escapeHtml(item.format)}</span><span><b>Развороты</b>${escapeHtml(item.spreads)}</span></div>
        <details class="oto-materials"><summary>Материалы</summary><dl>
          <div><dt>Обложка</dt><dd>${escapeHtml(item.cover)}</dd></div>
          <div><dt>Бумага</dt><dd>${escapeHtml(item.paper)}</dd></div>
          <div><dt>Защита листов</dt><dd>${escapeHtml(item.protection)}</dd></div>
        </dl></details>
      </section>`).join('');
  }

  function orderHtml(order) {
    const payment = order.paid
      ? '<span class="oto-paid">Оплачен</span>'
      : order.paymentUrl ? `<a class="oto-pay" href="${escapeHtml(order.paymentUrl)}">Оплатить</a>` : '<span class="oto-unpaid">Не оплачен</span>';
    return `
      <article class="oto-order" data-order-index="${order.index}">
        <header>
          <div><p class="oto-order-number">${escapeHtml(order.number)}</p><p class="oto-date">${escapeHtml(order.date)}</p></div>
          <div class="oto-status"><span>${escapeHtml(order.status || 'Статус не указан')}</span>${payment}</div>
        </header>
        <div class="oto-summary">
          <section><h3>В заказе</h3><ul class="oto-products">${productsHtml(order.products)}</ul></section>
          <section class="oto-print"><h3>В печати</h3>${specificationHtml(order.specification)}</section>
        </div>
        <footer><span class="oto-total">${escapeHtml(order.total)} ₽</span>${order.comment ? `<details><summary>Комментарий</summary><p>${escapeHtml(order.comment)}</p></details>` : ''}</footer>
      </article>`;
  }

  function render(root, orders, progress = '') {
    root.innerHTML = `
      <section class="oto-shell">
        <header class="oto-page-head"><div><p class="oto-kicker">Однотомник</p><h2>Заказы</h2><p>Вся печать — без длинной таблицы.</p></div><p class="oto-progress">${escapeHtml(progress)}</p></header>
        <div class="oto-orders">${orders.map(orderHtml).join('')}</div>
      </section>`;
  }

  async function run() {
    if (document.getElementById(ROOT_ID)) return;
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table || table.rows.length < 2) return;

    const orders = getOrders(table);
    const root = document.createElement('div');
    root.id = ROOT_ID;
    table.before(root);
    table.classList.add('oto-original-table');
    render(root, orders, `Загружаю спецификации: 0/${orders.length}`);

    for (let index = 0; index < orders.length; index += 1) {
      try {
        orders[index].specification = await loadSpecification(orders[index]);
      } catch (error) {
        orders[index].specification = [];
      }
      render(root, orders, `Загружаю спецификации: ${index + 1}/${orders.length}`);
    }
    render(root, orders, `Спецификации загружены: ${orders.length}`);
  }

  function cartSpecifications(rawHtml) {
    const scratch = document.createElement('div');
    scratch.innerHTML = rawHtml || '';
    scratch.querySelectorAll('br').forEach((breakElement) => breakElement.replaceWith('\n'));
    const lines = (scratch.textContent || '').split(/\r?\n/).map(clean).filter(Boolean);
    const specifications = [];
    let specification = null;

    for (const line of lines) {
      if (line.startsWith('Тип фотокниги:')) {
        if (specification) specifications.push(specification);
        specification = { title: line.replace('Тип фотокниги:', '').trim(), fields: {} };
      } else if (specification && line.includes(':')) {
        const divider = line.indexOf(':');
        specification.fields[line.slice(0, divider)] = line.slice(divider + 1).trim();
      }
    }
    if (specification) specifications.push(specification);
    return specifications;
  }

  function finishHtml(value) {
    const grainIcon = '<svg class="oto-grain-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.5c-2 2.7-4.2 4.6-4.2 7.2A4.2 4.2 0 0 0 8 13a4.2 4.2 0 0 0 4.2-4.3C12.2 6.1 10 4.2 8 1.5Z"/><circle cx="6.6" cy="8.2" r=".55"/><circle cx="8.8" cy="9.3" r=".55"/><circle cx="8.2" cy="6.5" r=".45"/></svg>';
    return escapeHtml(value).replace(/ЗЕРНО/gi, `<span class="oto-finish oto-finish-grain">${grainIcon}ЗЕРНО</span>`);
  }

  function cartSpecificationHtml(specification, viewUrl) {
    const fields = specification.fields;
    const preview = viewUrl ? `<a class="oto-cart-preview" href="${escapeHtml(viewUrl)}" title="Открыть макеты"><span>Загрузка обложки…</span></a>` : '';
    return `<li><strong>${escapeHtml(specification.title)}</strong><span>${escapeHtml(fields['Формат'] || 'Формат не указан')} · ${escapeHtml(fields['Развороты'] || 'развороты не указаны')}</span><small>${finishHtml(fields['Обложка'] || '')}</small>${preview}</li>`;
  }

  function cartBookTitle(specifications, fallback) {
    const specification = specifications[0];
    if (!specification) return fallback || 'Фотокнига';
    const fields = specification.fields;
    const type = clean(specification.title).replace(/^Выпускной\s+(альбом|папка)\s+/i, '');
    const format = clean(fields['Формат']);
    const spreads = clean(fields['Развороты']).replace(/\s*разворот(?:ов|а)?\.?$/i, '');
    const paper = clean(fields['Бумага']);
    const protection = clean(fields['Дополнительная защита листов']);
    const paperSummary = /без\s+основы/i.test(paper) ? 'без подложки' : '';
    const protectionSummary = /зерно/i.test(protection) ? 'зерно' : '';
    return [type, format, spreads ? `${spreads} разв.` : '', paperSummary, protectionSummary]
      .filter(Boolean)
      .join(' · ') || fallback || 'Фотокнига';
  }

  function pageLamination(specifications) {
    const fields = specifications[0]?.fields || {};
    const match = Object.entries(fields).find(([label]) => /защит[аы]\s+лист|ламинаци[яи]\s+лист|ламинаци[яи]\s+страниц/i.test(label));
    return clean(match?.[1]);
  }

  function imageSource(element, baseUrl) {
    const source = element?.getAttribute('href') || element?.getAttribute('xlink:href') || element?.getAttribute('src') || element?.getAttribute('data-src');
    if (!source) return '';
    try {
      return new URL(source, baseUrl).href;
    } catch (error) {
      return '';
    }
  }

  function coverSources(markup, pageUrl) {
    const page = new DOMParser().parseFromString(markup, 'text/html');
    const thumbnails = [...page.querySelectorAll('.thumbnail')];
    const covers = thumbnails
      .filter((thumbnail) => clean(thumbnail.querySelector('th, .title, strong')?.textContent) === 'Обложка')
      .map((thumbnail) => imageSource(thumbnail.querySelector('svg image, img'), pageUrl))
      .filter(Boolean);
    if (covers.length) return covers;
    const fallback = imageSource(page.querySelector('.thumbnail svg image, .thumbnail img'), pageUrl);
    return fallback ? [fallback] : [];
  }

  function liveCoverSources(pageUrl) {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      const startedAt = Date.now();
      const timeoutMs = 9000;
      let finished = false;
      const finish = (covers) => {
        if (finished) return;
        finished = true;
        frame.remove();
        resolve(covers);
      };
      const inspect = () => {
        const markup = frame.contentDocument?.documentElement?.outerHTML || '';
        const covers = markup ? coverSources(markup, pageUrl) : [];
        if (covers.length || Date.now() - startedAt >= timeoutMs) {
          finish(covers);
          return;
        }
        window.setTimeout(inspect, 350);
      };
      frame.className = 'oto-preview-loader';
      frame.src = pageUrl;
      frame.addEventListener('load', () => window.setTimeout(inspect, 250), { once: true });
      document.body.append(frame);
      window.setTimeout(inspect, 500);
    });
  }

  async function loadCartCoverPreviews(slots, pageUrls) {
    try {
      let covers = [];
      for (const pageUrl of pageUrls.filter(Boolean)) {
        covers = await liveCoverSources(pageUrl);
        if (covers.length) break;
      }
      if (!covers.length) throw new Error('No cover image found');
      slots.forEach((slot, index) => {
        const image = document.createElement('img');
        image.src = covers[index] || covers[0];
        image.alt = `Обложка ${index + 1}`;
        slot.replaceChildren(image);
      });
    } catch (error) {
      slots.forEach((slot) => {
        slot.textContent = 'Обложка недоступна';
        slot.classList.add('is-unavailable');
      });
    }
  }

  function runCart() {
    if (document.getElementById(ROOT_ID)) return true;
    const items = [...document.querySelectorAll('#items > .hidden-xs .item.row[data-id]')];
    if (!items.length) return false;

    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'oto-cart';
    root.innerHTML = `<header class="oto-cart-head"><p class="oto-kicker">Корзина</p><h2>Что сейчас в печати</h2><p>Параметры уже в корзине — открывать каждый макет не нужно.</p></header><div class="oto-cart-items"></div>`;
    const cards = root.querySelector('.oto-cart-items');

    items.forEach((item) => {
      const type = item.querySelector('.type');
      const viewLink = type?.querySelector('a[href*="/designer/view/"]');
      const editLink = type?.querySelector('a[href*="/designer/edit/"]');
      const removeLink = item.querySelector('.js-remove-item');
      const specifications = cartSpecifications(type?.dataset.originalTitle || type?.getAttribute('data-original-title'));
      const bookTitle = cartBookTitle(specifications, clean(type?.childNodes[0]?.textContent));
      const pagesFinish = pageLamination(specifications);
      const card = document.createElement('article');
      card.className = 'oto-cart-item';
      card.innerHTML = `
        <header><div><h3>${escapeHtml(bookTitle)}</h3><p>${escapeHtml(clean(item.querySelector('.item-count')?.textContent))} шт. · ${escapeHtml(clean(item.querySelector('.item-cost')?.textContent))} ${escapeHtml(clean(item.querySelector('.currency')?.textContent))}</p>${pagesFinish ? `<p class="oto-pages-finish">Ламинация страниц: ${finishHtml(pagesFinish)}</p>` : ''}</div></header>
        <div class="oto-cart-body"><section><h4>В печати</h4><ul>${specifications.map((specification) => cartSpecificationHtml(specification, viewLink?.href)).join('') || '<li>Параметры недоступны.</li>'}</ul></section></div>
        <footer><div class="oto-cart-actions">${viewLink ? `<a class="oto-view" href="${escapeHtml(viewLink.href)}">Смотреть макеты</a>` : ''}${editLink ? `<a class="oto-edit" href="${escapeHtml(editLink.href)}">Редактировать</a>` : ''}</div></footer>`;
      if (removeLink) {
        removeLink.classList.add('oto-remove');
        card.querySelector('footer').append(removeLink);
      }
      cards.append(card);
      const previewSlots = [...card.querySelectorAll('.oto-cart-preview')];
      if (viewLink && previewSlots.length) void loadCartCoverPreviews(previewSlots, [viewLink.href, editLink?.href]);
    });

    const originalItems = document.querySelector('#items');
    originalItems.before(root);
    originalItems.classList.add('oto-original-cart');
    return true;
  }

  function waitForCart() {
    if (runCart()) return;
    const observer = new MutationObserver(() => {
      if (runCart()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function ensureImageModal() {
    let modal = document.getElementById('oto-image-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'oto-image-modal';
    modal.innerHTML = '<div class="oto-image-dialog"><header><strong></strong><button type="button" aria-label="Закрыть">×</button></header><img alt="Увеличенный макет"></div>';
    const close = () => modal.classList.remove('is-open');
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.querySelector('button').addEventListener('click', close);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    document.body.append(modal);
    return modal;
  }

  function openImageModal(title, source) {
    const modal = ensureImageModal();
    modal.querySelector('strong').textContent = title;
    modal.querySelector('img').src = source;
    modal.classList.add('is-open');
  }

  function getThumbnailTitle(thumbnail) {
    return clean(thumbnail.querySelector('table th')?.textContent) || 'Макет';
  }

  function getThumbnailSource(thumbnail) {
    const image = thumbnail.querySelector('svg image');
    return image?.getAttribute('href') || image?.getAttribute('xlink:href') || '';
  }

  function getFileWarning(thumbnail) {
    if (thumbnail.querySelector('.status-file .text-success')) return '';
    const rows = [...thumbnail.querySelectorAll('table tr')];
    const details = rows.slice(1).map((row) => clean(row.textContent)).filter(Boolean).join(' · ');
    return details || 'Файл требует проверки';
  }

  function enhanceThumbnail(thumbnail) {
    if (thumbnail.dataset.otoReady === 'true') return;
    thumbnail.dataset.otoReady = 'true';
    const title = getThumbnailTitle(thumbnail);
    const source = getThumbnailSource(thumbnail);
    const warning = getFileWarning(thumbnail);
    thumbnail.classList.toggle('oto-has-warning', Boolean(warning));

    const controls = document.createElement('div');
    controls.className = 'oto-thumbnail-controls';
    controls.innerHTML = `<strong>${escapeHtml(title)}</strong>${source ? '<button type="button" class="oto-zoom" aria-label="Увеличить макет" title="Увеличить макет">⛶</button>' : ''}`;
    if (source) controls.querySelector('button').addEventListener('click', () => openImageModal(title, source));
    thumbnail.prepend(controls);

    const table = thumbnail.querySelector('.table-responsive');
    if (table) table.hidden = true;
    if (warning) {
      const message = document.createElement('p');
      message.className = 'oto-file-warning';
      message.textContent = warning;
      thumbnail.append(message);
    }
  }

  function enhanceBook(panel) {
    if (panel.dataset.otoReady === 'true') return;
    const book = panel.querySelector('.book');
    const body = book?.querySelector(':scope > .panel-body');
    const thumbnails = body ? [...body.querySelectorAll(':scope > .thumbnail')] : [];
    if (!book || !body || !thumbnails.length) return;

    panel.dataset.otoReady = 'true';
    panel.classList.add('oto-book-panel');
    book.classList.add('in');
    book.style.height = 'auto';
    thumbnails.forEach(enhanceThumbnail);

    const strip = document.createElement('div');
    strip.className = 'oto-spreads-strip';
    strip.style.setProperty('--oto-page-count', String(thumbnails.length));
    thumbnails.forEach((thumbnail) => strip.append(thumbnail));
    body.append(strip);

    const warningCount = thumbnails.filter((thumbnail) => thumbnail.classList.contains('oto-has-warning')).length;
    const status = document.createElement('span');
    status.className = warningCount ? 'oto-book-warning' : 'oto-book-ok';
    status.textContent = warningCount ? `${warningCount} ${warningCount === 1 ? 'ошибка' : 'ошибки'}` : 'Файлы проверены';
    panel.querySelector('.panel-heading .text-right')?.prepend(status);
  }

  const SETTINGS = {
    'Группа фотокниг': { icon: 'glyphicon-book', favorite: ['525'], rare: [] },
    'Тип фотокниги': { icon: 'glyphicon-picture', favorite: ['13'], rare: [] },
    'Формат': { icon: 'glyphicon-resize-full', favorite: ['3941', '3961'], rare: [] },
    'Обложка': { icon: 'glyphicon-bookmark', favorite: ['24886'], rare: ['21315'] },
    'Бумага': { icon: 'glyphicon-file', favorite: ['21380'], rare: ['21379'] },
    'Дополнительная защита листов': { icon: 'glyphicon-tint', favorite: ['24363'], rare: ['21382'] },
  };

  const STANDARD_PROPERTY_IDS = ['525', '13', '24886', '21380', '24363'];

  const SETTING_GROUPS = {
    'Группа фотокниг': '15',
    'Тип фотокниги': '13',
    'Формат': '1',
    'Обложка': '2',
    'Бумага': '6',
    'Дополнительная защита листов': '47',
  };

  const SHORT_OPTION_LABELS = {
    '497': 'Классические', '525': 'Полиграфические',
    '6': 'Папка Лайфлат', '13': 'Альбом Лайфлат', '14': 'Альбом Стандарт', '4': 'Стандарт мягкий', '10': 'Папка Двойка', '11': 'Папка Тройка',
    '21314': 'Матовая', '21315': 'Глянцевая', '24886': 'Зерно',
    '21380': 'Без основы 0,6 мм', '21379': 'Картон 1 мм', '21378': 'Картон 1,4 мм', '22250': 'Пластик 1,2 мм',
    '21381': 'Матовая', '21382': 'Глянцевая', '24363': 'Зерно',
  };

  function settingsPanel(label) {
    return [...document.querySelectorAll('.calculator-params .panel')].find((panel) => {
      const heading = panel.querySelector(':scope > .panel-heading');
      return heading?.dataset.otoLabel === label || clean(heading?.textContent) === label;
    });
  }

  function activeSetting(label) {
    const group = SETTING_GROUPS[label];
    return clean(document.querySelector(`.js-set-property[data-group="${group}"].property-item_active span`)?.textContent);
  }

  function grainIsSynchronized() {
    const protection = activeSetting('Дополнительная защита листов').toLowerCase();
    return Boolean(protection);
  }

  function updateSettingsToolbar() {
    const toolbar = document.querySelector('.oto-settings-toolbar');
    if (!toolbar) return;
    const labels = ['Тип фотокниги', 'Формат', 'Обложка', 'Бумага', 'Дополнительная защита листов'];
    const summary = toolbar.querySelector('.oto-settings-summary');
    summary.innerHTML = labels.map((label) => {
      const value = activeSetting(label);
      return value ? `<span><b>${escapeHtml(label.replace('Дополнительная защита листов', 'Защита'))}</b>${escapeHtml(value)}</span>` : '';
    }).join('');

    const lamination = toolbar.querySelector('.oto-lamination-state');
    const synchronized = grainIsSynchronized();
    lamination.className = `oto-lamination-state ${synchronized ? 'is-good' : 'is-warning'}`;
    lamination.innerHTML = synchronized
      ? `<span class="glyphicon glyphicon-ok-sign"></span><strong>Защита листов:</strong><span>${escapeHtml(activeSetting('Дополнительная защита листов'))}</span>`
      : '<span class="glyphicon glyphicon-warning-sign"></span><strong>Не выбрана защита листов</strong><button type="button">Выбрать зерно</button>';
    lamination.querySelector('button')?.addEventListener('click', () => {
      document.querySelector('.js-set-property[data-id="24363"]')?.click();
      window.setTimeout(updateSettingsToolbar, 350);
    });
  }

  function applyStandardPreset(button) {
    button.disabled = true;
    button.classList.add('is-applying');
    let index = 0;
    const applyNext = () => {
      if (index >= STANDARD_PROPERTY_IDS.length) {
        button.disabled = false;
        button.classList.remove('is-applying');
        window.setTimeout(updateSettingsToolbar, 350);
        return;
      }
      const id = STANDARD_PROPERTY_IDS[index];
      index += 1;
      const option = document.querySelector(`.js-set-property[data-id="${id}"]`);
      if (option && !option.classList.contains('property-item_active')) option.click();
      window.setTimeout(applyNext, 280);
    };
    applyNext();
  }

  function createSettingsToolbar(params) {
    const toolbar = document.createElement('section');
    toolbar.className = 'oto-settings-toolbar';
    toolbar.innerHTML = `
      <div class="oto-settings-topline">
        <div><p class="oto-kicker">Параметры печати</p><h2>Настройка тиража</h2><p>Частые параметры — сразу под рукой. Остальное не мешает работе.</p></div>
        <button type="button" class="oto-standard-preset"><span class="glyphicon glyphicon-flash"></span><span><b>Мой стандарт</b><small>Лайфлат · зерно · без основы</small></span></button>
      </div>
      <div class="oto-lamination-state"></div>
      <div class="oto-settings-summary"></div>`;
    toolbar.querySelector('.oto-standard-preset').addEventListener('click', (event) => applyStandardPreset(event.currentTarget));
    params.before(toolbar);
    return toolbar;
  }

  function enhanceSettingsPanel(panel, label, config) {
    if (panel.dataset.otoSettings === 'true' && panel.querySelector('.oto-choice-check')) return false;
    panel.dataset.otoSettings = 'true';
    panel.classList.add('oto-settings-panel');
    const heading = panel.querySelector('.panel-heading');
    heading.dataset.otoLabel = label;
    const displayLabel = label === 'Дополнительная защита листов' ? 'Защита листов' : label;
    heading.innerHTML = `<span class="glyphicon ${config.icon}" aria-hidden="true"></span><strong>${escapeHtml(displayLabel)}</strong>`;

    let hiddenCount = 0;
    panel.querySelectorAll('.property-item').forEach((option) => {
      const id = option.dataset.id;
      const title = clean(option.querySelector('span')?.textContent);
      const shortLabel = SHORT_OPTION_LABELS[id];
      if (shortLabel) {
        const titleElement = option.querySelector('span');
        titleElement.textContent = shortLabel;
        option.title = title;
      }
      const tag = document.createElement('small');
      tag.className = 'oto-usage-tag';
      if (config.favorite.includes(id)) {
        option.classList.add('oto-option-favorite');
        tag.textContent = 'часто';
      } else if (config.rare.includes(id)) {
        option.classList.add('oto-option-rare');
        tag.textContent = 'редко';
      } else {
        option.classList.add('oto-option-more');
        hiddenCount += 1;
      }
      if (tag.textContent) option.append(tag);
      const check = document.createElement('span');
      check.className = 'glyphicon glyphicon-ok oto-choice-check';
      option.prepend(check);
    });

    if (hiddenCount) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'oto-more-toggle';
      toggle.innerHTML = `<span class="glyphicon glyphicon-option-horizontal"></span> Ещё ${hiddenCount}`;
      toggle.addEventListener('click', () => {
        const expanded = panel.classList.toggle('oto-expanded');
        toggle.innerHTML = expanded
          ? '<span class="glyphicon glyphicon-chevron-up"></span> Скрыть редкие'
          : `<span class="glyphicon glyphicon-option-horizontal"></span> Ещё ${hiddenCount}`;
      });
      panel.querySelector('.panel-body').append(toggle);
    }
    return true;
  }

  function enhanceSettings() {
    const params = document.querySelector('.calculator-params');
    if (!params) return false;
    let changed = false;
    Object.entries(SETTINGS).forEach(([label, config]) => {
      const panel = settingsPanel(label);
      if (panel) changed = enhanceSettingsPanel(panel, label, config) || changed;
    });

    const counters = [...params.querySelectorAll('.form-group')].filter((group) => {
      const label = clean(group.querySelector('label')?.textContent);
      return label === 'Развороты' || label === 'Количество';
    });
    let counterRow = params.querySelector('.oto-counters-row');
    if (!counterRow && counters.length) {
      counterRow = document.createElement('div');
      counterRow.className = 'oto-counters-row';
      params.querySelector(':scope > .row')?.append(counterRow);
    }
    counters.forEach((group) => {
      const label = clean(group.querySelector('label')?.textContent);
      group.classList.add('oto-counter');
      if (!group.querySelector('.oto-counter-icon')) {
        const icon = document.createElement('span');
        icon.className = `glyphicon ${label === 'Развороты' ? 'glyphicon-th-large' : 'glyphicon-duplicate'} oto-counter-icon`;
        group.querySelector('label')?.prepend(icon);
      }
      if (counterRow && group.parentElement !== counterRow) counterRow.append(group);
    });

    let toolbar = document.querySelector('.oto-settings-toolbar');
    if (!toolbar) {
      toolbar = createSettingsToolbar(params);
      changed = true;
    }
    if (params.dataset.otoListening !== 'true') {
      params.dataset.otoListening = 'true';
      params.addEventListener('click', () => window.setTimeout(updateSettingsToolbar, 350));
    }
    if (changed) updateSettingsToolbar();
    return true;
  }

  function enhanceEditor() {
    const panels = [...document.querySelectorAll('.panel-book')];
    if (!panels.length) return false;
    document.body.classList.add('oto-editor');
    enhanceSettings();
    panels.forEach(enhanceBook);
    ensureImageModal();
    return true;
  }

  function watchEditor() {
    enhanceEditor();
    const observer = new MutationObserver(() => enhanceEditor());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (location.pathname === '/shopcart') waitForCart();
  else if (location.pathname === '/profile/orders') run();
  else if (location.pathname.startsWith('/photobook/designer/edit/')) watchEditor();
})();
