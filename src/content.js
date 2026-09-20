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
    const lines = (scratch.innerText || '').split(/\r?\n/).map(clean).filter(Boolean);
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

  function cartSpecificationHtml(specification) {
    const fields = specification.fields;
    return `<li><strong>${escapeHtml(specification.title)}</strong><span>${escapeHtml(fields['Формат'] || 'Формат не указан')} · ${escapeHtml(fields['Развороты'] || 'развороты не указаны')}</span><small>${escapeHtml(fields['Обложка'] || '')}</small></li>`;
  }

  function runCart() {
    if (document.getElementById(ROOT_ID)) return;
    const items = [...document.querySelectorAll('#items > .hidden-xs .item.row[data-id]')];
    if (!items.length) return;

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
      const card = document.createElement('article');
      card.className = 'oto-cart-item';
      card.innerHTML = `
        <header><div><h3>${escapeHtml(clean(type?.childNodes[0]?.textContent) || 'Фотокнига')}</h3><p>${escapeHtml(clean(item.querySelector('.item-count')?.textContent))} шт. · ${escapeHtml(clean(item.querySelector('.item-cost')?.textContent))} ${escapeHtml(clean(item.querySelector('.currency')?.textContent))}</p></div></header>
        <div class="oto-cart-body"><section><h4>В печати</h4><ul>${specifications.map(cartSpecificationHtml).join('') || '<li>Параметры недоступны.</li>'}</ul></section></div>
        <footer><div class="oto-cart-actions">${viewLink ? `<a class="oto-view" href="${escapeHtml(viewLink.href)}">Смотреть макеты</a>` : ''}${editLink ? `<a class="oto-edit" href="${escapeHtml(editLink.href)}">Редактировать</a>` : ''}</div></footer>`;
      if (removeLink) {
        removeLink.classList.add('oto-remove');
        card.querySelector('footer').append(removeLink);
      }
      cards.append(card);
    });

    const originalItems = document.querySelector('#items');
    originalItems.before(root);
    originalItems.classList.add('oto-original-cart');
  }

  if (location.pathname === '/shopcart') runCart();
  else if (location.pathname === '/profile/orders') run();
})();
