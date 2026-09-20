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
    return [...root.querySelectorAll('*')]
      .filter((element) => element.children.length === 0)
      .map((element) => clean(element.textContent))
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
        <dl>
          <div><dt>Формат</dt><dd>${escapeHtml(item.format)}</dd></div>
          <div><dt>Развороты</dt><dd>${escapeHtml(item.spreads)}</dd></div>
          <div><dt>Обложка</dt><dd>${escapeHtml(item.cover)}</dd></div>
          <div><dt>Бумага</dt><dd>${escapeHtml(item.paper)}</dd></div>
          <div><dt>Защита листов</dt><dd>${escapeHtml(item.protection)}</dd></div>
        </dl>
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

  run();
})();
