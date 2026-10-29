/*
 * Aurora Supply Co. — demo store behaviour.
 * The store is a real, instrumented website: pages render from the catalog, the cart persists,
 * checkout creates flagged TEST orders (no payment, no fulfilment), and the Syntro SDK captures
 * every interaction for the synthetic session.
 */
(function () {
  var S = window.SyntroStorage;
  var CART_KEY = 'aurora_cart';
  var USER_KEY = 'aurora_user';
  var ORDERS_KEY = 'aurora_orders';
  var catalog = window.STORE_CATALOG || [];
  var byId = {};
  catalog.forEach(function (p) {
    byId[p.id] = p;
  });

  function money(n) {
    return '$' + Number(n).toFixed(2);
  }
  function param(name) {
    return new URL(location.href).searchParams.get(name);
  }
  function getJSON(key, fallback) {
    try {
      var raw = S.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function getCart() {
    return getJSON(CART_KEY, []);
  }
  function setCart(items) {
    S.set(CART_KEY, JSON.stringify(items));
    renderCartCount();
  }
  function cartTotal(items) {
    return items.reduce(function (sum, it) {
      return sum + it.price * it.quantity;
    }, 0);
  }
  function renderCartCount() {
    var el = document.getElementById('cart-count');
    if (!el) return;
    var n = getCart().reduce(function (s, it) {
      return s + it.quantity;
    }, 0);
    el.textContent = String(n);
  }
  function track(type, props) {
    if (window.syntro) window.syntro.track(type, props);
  }
  function identify(email, method) {
    if (window.syntro) window.syntro.identify({ email: email, method: method });
  }
  function productCard(p) {
    return (
      '<a class="card" data-product-card data-product-id="' + p.id + '" href="product.html?id=' + p.id + '">' +
      '<div class="art" style="background: hsl(' + p.hue + ' 70% 94%)">' + p.art + '</div>' +
      '<div class="card-body"><span class="cat">' + p.category + '</span><span class="name">' + p.name + '</span><span class="price">' + money(p.price) + '</span></div></a>'
    );
  }

  var page = document.body.getAttribute('data-page');
  renderCartCount();

  if (page === 'home') {
    document.getElementById('featured-grid').innerHTML = catalog.slice(0, 3).map(productCard).join('');
    var nl = document.getElementById('newsletter-form');
    nl.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('newsletter-email').value.trim();
      if (!email) return;
      identify(email, 'newsletter');
      track('lead', { form: 'newsletter', value: 25, currency: 'USD' });
      nl.classList.add('hidden');
      document.getElementById('newsletter-success').classList.remove('hidden');
    });
  }

  if (page === 'products') {
    var q = (param('q') || '').trim();
    var list = q
      ? catalog.filter(function (p) {
          var hay = (p.name + ' ' + p.category + ' ' + p.tagline).toLowerCase();
          return hay.indexOf(q.toLowerCase()) !== -1;
        })
      : catalog;
    document.getElementById('product-grid').innerHTML = list.length ? list.map(productCard).join('') : '<p class="muted">No products match “' + q + '”.</p>';
    document.getElementById('results-count').textContent = list.length + ' product' + (list.length === 1 ? '' : 's') + (q ? ' for “' + q + '”' : '');
    var input = document.getElementById('search-input');
    input.value = q;
    document.getElementById('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      location.href = 'products.html?q=' + encodeURIComponent(input.value.trim());
    });
    if (q) track('search', { query: q, results: list.length });
  }

  if (page === 'product') {
    var p = byId[param('id')] || catalog[0];
    document.title = p.name + ' — Aurora Supply Co.';
    document.getElementById('product-art').textContent = p.art;
    document.getElementById('product-art').style.background = 'hsl(' + p.hue + ' 70% 94%)';
    document.getElementById('product-category').textContent = p.category;
    document.getElementById('product-title').textContent = p.name;
    document.getElementById('product-tagline').textContent = p.tagline;
    document.getElementById('product-price').textContent = money(p.price);
    document.getElementById('product-description').textContent = p.description;
    track('view_item', { product_id: p.id, name: p.name, price: p.price, category: p.category });
    document.getElementById('add-to-cart').addEventListener('click', function () {
      var qty = Math.max(1, parseInt(document.getElementById('qty').value, 10) || 1);
      var cart = getCart();
      var existing = cart.find(function (it) {
        return it.productId === p.id;
      });
      if (existing) existing.quantity += qty;
      else cart.push({ productId: p.id, name: p.name, price: p.price, quantity: qty });
      setCart(cart);
      track('add_to_cart', { product_id: p.id, name: p.name, price: p.price, quantity: qty, value: p.price * qty, currency: 'USD' });
      var toast = document.getElementById('cart-toast');
      toast.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () {
        toast.classList.remove('show');
      }, 4000);
    });
  }

  if (page === 'cart') {
    var cart = getCart();
    var body = document.getElementById('cart-body');
    if (!cart.length) {
      document.getElementById('cart-table').classList.add('hidden');
      document.getElementById('cart-empty').classList.remove('hidden');
    } else {
      body.innerHTML = cart
        .map(function (it) {
          return '<tr><td>' + it.name + '</td><td>' + it.quantity + '</td><td>' + money(it.price) + '</td><td>' + money(it.price * it.quantity) + '</td></tr>';
        })
        .join('');
      document.getElementById('cart-total').textContent = money(cartTotal(cart));
    }
    track('view_cart', { value: cartTotal(cart), items: cart.length });
  }

  if (page === 'checkout') {
    var items = getCart();
    var form = document.getElementById('checkout-form');
    if (!items.length) {
      form.classList.add('hidden');
      document.getElementById('checkout-empty').classList.remove('hidden');
    } else {
      document.getElementById('summary-body').innerHTML = items
        .map(function (it) {
          return '<tr><td>' + it.name + ' × ' + it.quantity + '</td><td style="text-align:right">' + money(it.price * it.quantity) + '</td></tr>';
        })
        .join('');
      document.getElementById('summary-total').textContent = money(cartTotal(items));
      var known = S.get(USER_KEY);
      if (known) document.getElementById('email').value = known;
      track('begin_checkout', { value: cartTotal(items), currency: 'USD', items: items.length });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('email').value.trim();
        if (!email) return;
        var total = cartTotal(items);
        var order = {
          id: 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
          total: total,
          currency: 'USD',
          items: items.map(function (it) {
            return { productId: it.productId, name: it.name, price: it.price, quantity: it.quantity };
          }),
          email: email,
          test: true,
          ts: new Date().toISOString(),
        };
        var orders = getJSON(ORDERS_KEY, []);
        orders.push(order);
        S.set(ORDERS_KEY, JSON.stringify(orders));
        S.set(USER_KEY, email);
        identify(email, 'checkout');
        setCart([]);
        location.href = 'order.html?id=' + encodeURIComponent(order.id) + '&total=' + encodeURIComponent(total.toFixed(2));
      });
    }
  }

  if (page === 'order') {
    var id = param('id');
    var orders = getJSON(ORDERS_KEY, []);
    var order = orders.filter(function (o) {
      return o.id === id;
    })[0] || { id: id, total: Number(param('total') || 0), currency: 'USD', items: [], test: true };
    window.__syntroOrder = order;
    document.getElementById('order-id').textContent = order.id;
    document.getElementById('order-total').textContent = money(order.total);
    document.getElementById('order-items').innerHTML = order.items.length
      ? order.items
          .map(function (it) {
            return '<li>' + it.name + ' × ' + it.quantity + ' — ' + money(it.price * it.quantity) + '</li>';
          })
          .join('')
      : '<li class="muted">Item detail unavailable</li>';
    track('purchase', { order_id: order.id, revenue: order.total, value: order.total, currency: order.currency, items: order.items, test_order: true });
  }

  if (page === 'account') {
    var welcome = document.getElementById('account-welcome');
    function showWelcome(name) {
      document.getElementById('welcome-name').textContent = name;
      document.getElementById('account-forms').classList.add('hidden');
      welcome.classList.remove('hidden');
    }
    document.getElementById('register-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var first = document.getElementById('reg-first').value.trim();
      var email = document.getElementById('reg-email').value.trim();
      if (!email) return;
      S.set(USER_KEY, email);
      identify(email, 'register');
      track('signup', { method: 'email' });
      showWelcome(first || email);
    });
    document.getElementById('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      if (!email) return;
      S.set(USER_KEY, email);
      identify(email, 'login');
      track('login', { method: 'email' });
      showWelcome(email.split('@')[0].split('.')[0].replace(/^\w/, function (c) { return c.toUpperCase(); }));
    });
  }

  if (page === 'conversion') {
    var type = param('type') || 'custom_conversion';
    var value = Number(param('value') || 0);
    track(type, { value: value, revenue: value, currency: 'USD' });
    document.getElementById('conversion-type').textContent = type;
    document.getElementById('conversion-value').textContent = money(value);
    document.getElementById('conversion-fired').classList.remove('hidden');
  }
})();
