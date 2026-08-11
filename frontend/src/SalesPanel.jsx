import { useState, useEffect, useRef } from 'react';
import api from './api';

// Cores (mesmas do App.jsx)
const C = { bg:"#0A0A0C", s1:"#111114", s2:"#18181C", s3:"#1F1F24", brd:"rgba(255,215,64,0.08)", brdH:"rgba(255,215,64,0.2)", gold:"#FFD740", goldD:"#FF8F00", txt:"#EEEEF0", dim:"rgba(255,255,255,0.75)", grn:"#00E676", red:"#FF5252", blu:"#40C4FF", wa:"#25D366" };

const payMethods = [
  { id: 'pix', label: 'PIX' },
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'credito', label: 'Crédito' },
  { id: 'debito', label: 'Débito' },
  { id: 'crediario', label: 'Crediário' },
];

export default function SalesPanel({ customerPhone, customerName, onClose }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileTab, setMobileTab] = useState('produtos'); // 'produtos' | 'carrinho'
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const selectedStore = 'loja4'; // E-commerce fixo
  const [payment, setPayment] = useState('pix');
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountScope, setDiscountScope] = useState('sale'); // 'sale' ou 'item'
  const [itemDiscounts, setItemDiscounts] = useState({}); // { product_id: valor }
  const [showDiscountPanel, setShowDiscountPanel] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [saleResult, setSaleResult] = useState(null);
  const searchTimeout = useRef(null);

  // Busca cliente pelo telefone
  useEffect(() => {
    if (customerPhone) {
      api.findCustomer(customerPhone).then(c => {
        if (c && !c.not_found) setCustomer(c);
      }).catch(() => {});
    }
  }, [customerPhone]);

  // Busca com debounce
  const doSearch = (term) => {
    setSearch(term);
    clearTimeout(searchTimeout.current);
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const prods = await api.searchProducts(term);
        setResults(prods);
      } catch { setResults([]); }
      setSearching(false);
    }, 400);
  };

  // Adicionar ao carrinho
  const addToCart = (product) => {
    setCart(prev => {
      const exists = prev.find(i => i.product_id === product.id);
      if (exists) {
        return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        price: parseFloat(product.price),
        quantity: 1,
        photo_url: product.photo_url,
        total_stock: parseInt(product.total_stock),
      }];
    });
  };

  const updateQty = (productId, qty) => {
    if (qty < 1) return removeFromCart(productId);
    setCart(prev => prev.map(i => i.product_id === productId ? { ...i, quantity: qty } : i));
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(i => i.product_id !== productId));
  };

  // Cálculos (mesma lógica do ERP)
  const subtotal = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  let discountVal = 0;
  let discountLabel = '';

  if (discountScope === 'sale' && parseFloat(discount || 0) > 0) {
    if (discountType === 'percent') {
      discountVal = subtotal * parseFloat(discount) / 100;
      discountLabel = `${discount}% na venda toda`;
    } else {
      discountVal = parseFloat(discount);
      discountLabel = `R$ ${parseFloat(discount).toFixed(2)} na venda toda`;
    }
  } else if (discountScope === 'item') {
    const activeItems = cart.filter(i => (itemDiscounts[i.product_id] || 0) > 0);
    activeItems.forEach(i => {
      const val = itemDiscounts[i.product_id] || 0;
      if (discountType === 'percent') {
        discountVal += Math.round(i.price * i.quantity * val / 100 * 100) / 100;
      } else {
        discountVal += Math.min(val, i.price * i.quantity);
      }
    });
    if (activeItems.length > 0) {
      discountLabel = `desconto em ${activeItems.length === 1 ? activeItems[0].name : activeItems.length + ' produtos'}`;
    }
  }
  discountVal = Math.min(discountVal, subtotal);
  const total = Math.max(0, subtotal - discountVal);

  // Finalizar venda
  const finishSale = async () => {
    if (cart.length === 0 || finishing) return;
    setFinishing(true);
    try {
      const result = await api.createSale({
        store_id: selectedStore,
        customer_id: customer?.id || null,
        customer_phone: customerPhone,
        customer_name: customerName || customer?.name || null,
        items: cart.map(i => ({ product_id: i.product_id, name: i.name, sku: i.sku, price: i.price, quantity: i.quantity })),
        payment_method: payment,
        discount: discountVal,
        discount_type: 'fixed',
        discount_label: discountLabel,
      });
      setSaleResult(result.sale);
      setCart([]);
      setDiscount('');
      setItemDiscounts({});
      setDiscountScope('sale');
      setShowDiscountPanel(false);
    } catch (e) {
      alert('Erro ao finalizar venda: ' + (e.message || 'Erro desconhecido'));
    }
    setFinishing(false);
  };

  // Se a venda foi finalizada com sucesso
  if (saleResult) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 30 }}>
        <div style={{ fontSize: 48 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.grn }}>Venda Finalizada!</div>
        <div style={{ fontSize: 14, color: C.dim }}>Total: <strong style={{ color: C.txt }}>R$ {saleResult.total.toFixed(2)}</strong></div>
        <div style={{ fontSize: 12, color: C.wa }}>
          {customerPhone ? '📱 Cupom enviado via WhatsApp!' : 'Sem WhatsApp — cupom não enviado'}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button style={btnGold} onClick={() => setSaleResult(null)}>Nova Venda</button>
          <button style={btnOutline} onClick={onClose}>Voltar ao Chat</button>
        </div>
      </div>
    );
  }

  // ─── SEÇÕES (compartilhadas entre desktop e mobile) ───
  const searchSection = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRight: isMobile ? 'none' : `1px solid ${C.brd}` }}>
      {/* Campo de busca */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.brd}` }}>
        <input
          style={{ ...inputStyle, marginBottom: 4 }}
          placeholder="🔍 Buscar produto, SKU ou código..."
          value={search}
          onChange={e => doSearch(e.target.value)}
          autoFocus={!isMobile}
        />
        <div style={{ fontSize: 10, color: C.dim }}>📍 D'Black E-commerce</div>
      </div>

      {/* Resultados */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 8 }}>
        {searching && <div style={{ padding: 20, textAlign: 'center', color: C.dim, fontSize: 12 }}>Buscando...</div>}

        {!searching && results.length === 0 && search.length >= 2 && (
          <div style={{ padding: 20, textAlign: 'center', color: C.dim, fontSize: 12 }}>Nenhum produto encontrado</div>
        )}

        {!searching && search.length < 2 && (
          <div style={{ padding: 30, textAlign: 'center', color: C.dim, fontSize: 12 }}>Digite pelo menos 2 caracteres para buscar</div>
        )}

        {results.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px', borderRadius: 8, border: `1px solid ${C.brd}`, marginBottom: 6, background: C.s2, cursor: 'pointer', transition: 'border-color .15s' }}
            onClick={() => addToCart(p)}
            onMouseOver={e => e.currentTarget.style.borderColor = C.gold}
            onMouseOut={e => e.currentTarget.style.borderColor = 'rgba(255,215,64,0.08)'}
          >
            {/* Foto */}
            <div style={{ width: 48, height: 48, borderRadius: 6, background: C.s3, overflow: 'hidden', flexShrink: 0 }}>
              {p.photo_url
                ? <img src={p.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: C.dim }}>📦</div>
              }
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              <div style={{ fontSize: 10, color: C.dim }}>
                SKU: {p.sku || '-'} {p.size ? `| Tam: ${p.size}` : ''} {p.color ? `| Cor: ${p.color}` : ''}
              </div>
            </div>
            {/* Preço e estoque */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.grn }}>R$ {parseFloat(p.price).toFixed(2)}</div>
              <div style={{ fontSize: 10, color: parseInt(p.total_stock) > 0 ? C.dim : C.red }}>
                Est: {p.total_stock}
              </div>
            </div>
            {/* Botão adicionar */}
            <button style={{ ...btnOutline, padding: '10px 14px', fontSize: 18, border: `1px solid ${C.wa}`, color: C.wa, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); addToCart(p); }}>+</button>
          </div>
        ))}
      </div>
    </div>
  );

  const cartItemsSection = (
    <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 8, minHeight: 0 }}>
      {cart.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: C.dim, fontSize: 12 }}>Carrinho vazio — {isMobile ? 'busque um produto na aba Produtos' : 'clique em um produto para adicionar'}</div>
      )}

      {cart.map(item => (
        <div key={item.product_id} style={{ padding: '10px', borderRadius: 8, border: `1px solid ${C.brd}`, marginBottom: 6, background: C.s2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
              <div style={{ fontSize: 10, color: C.dim }}>R$ {item.price.toFixed(2)} cada</div>
            </div>
            <button style={{ ...btnMini, padding: '6px 12px' }} onClick={() => removeFromCart(item.product_id)}>🗑</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <button style={{ ...btnMini, padding: '6px 14px', fontSize: 16 }} onClick={() => updateQty(item.product_id, item.quantity - 1)}>−</button>
            <span style={{ fontSize: 15, fontWeight: 800, minWidth: 24, textAlign: 'center' }}>{item.quantity}</span>
            <button style={{ ...btnMini, padding: '6px 14px', fontSize: 16 }} onClick={() => updateQty(item.product_id, item.quantity + 1)}>+</button>
            <div style={{ flex: 1 }} />
            <span style={{ fontWeight: 800, fontSize: 13, color: C.grn }}>R$ {(item.price * item.quantity).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );

  const checkoutSection = (
          <div style={{ padding: '10px 14px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.brd}`, background: C.s2, flexShrink: 0 }}>

            {/* Desconto */}
            <div style={{ marginBottom: 8 }}>
              <button onClick={() => setShowDiscountPanel(!showDiscountPanel)}
                style={{ ...btnOutline, width: '100%', textAlign: 'center', padding: '6px', color: discountVal > 0 ? C.red : C.dim, borderColor: discountVal > 0 ? 'rgba(255,82,82,.3)' : C.brd }}>
                {discountVal > 0 ? `🏷️ Desconto: -R$ ${discountVal.toFixed(2)}` : '🏷️ Adicionar desconto'}
              </button>

              {showDiscountPanel && (
                <div style={{ marginTop: 6, background: C.s3, borderRadius: 8, padding: 10, border: `1px solid ${C.brd}` }}>
                  {/* Escopo: venda toda ou por produto */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <button onClick={() => { setDiscountScope('sale'); setItemDiscounts({}); }}
                      style={{ flex: 1, padding: '5px', borderRadius: 6, border: `1px solid ${discountScope === 'sale' ? C.gold : C.brd}`, background: discountScope === 'sale' ? 'rgba(255,215,64,.1)' : C.s1, color: discountScope === 'sale' ? C.gold : C.dim, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                      Venda toda
                    </button>
                    <button onClick={() => { setDiscountScope('item'); setDiscount(''); }}
                      style={{ flex: 1, padding: '5px', borderRadius: 6, border: `1px solid ${discountScope === 'item' ? C.gold : C.brd}`, background: discountScope === 'item' ? 'rgba(255,215,64,.1)' : C.s1, color: discountScope === 'item' ? C.gold : C.dim, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                      Por produto
                    </button>
                  </div>

                  {/* Tipo: R$ ou % */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <button onClick={() => setDiscountType('fixed')}
                      style={{ flex: 1, padding: '4px', borderRadius: 6, border: `1px solid ${discountType === 'fixed' ? C.gold : C.brd}`, background: discountType === 'fixed' ? 'rgba(255,215,64,.1)' : C.s1, color: discountType === 'fixed' ? C.gold : C.dim, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                      R$ Fixo
                    </button>
                    <button onClick={() => setDiscountType('percent')}
                      style={{ flex: 1, padding: '4px', borderRadius: 6, border: `1px solid ${discountType === 'percent' ? C.gold : C.brd}`, background: discountType === 'percent' ? 'rgba(255,215,64,.1)' : C.s1, color: discountType === 'percent' ? C.gold : C.dim, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                      % Percentual
                    </button>
                  </div>

                  {/* Campo de desconto por escopo */}
                  {discountScope === 'sale' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input style={{ ...inputStyle, marginBottom: 0, flex: 1, padding: '6px 8px', fontSize: 12 }}
                        placeholder={discountType === 'percent' ? 'Ex: 10' : 'Ex: 25.00'} type="number" value={discount}
                        onChange={e => setDiscount(e.target.value)} />
                      <span style={{ fontSize: 12, color: C.dim }}>{discountType === 'percent' ? '%' : 'R$'}</span>
                    </div>
                  )}

                  {discountScope === 'item' && cart.length > 0 && (
                    <div style={{ background: C.s2, borderRadius: 8, padding: '6px 8px' }}>
                      {cart.map(i => (
                        <div key={i.product_id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ flex: 1, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</span>
                          <input style={{ ...inputStyle, marginBottom: 0, width: 60, padding: '4px 6px', fontSize: 11, textAlign: 'right' }}
                            type="number" placeholder="0" value={itemDiscounts[i.product_id] || ''}
                            onChange={e => setItemDiscounts(prev => ({ ...prev, [i.product_id]: parseFloat(e.target.value) || 0 }))} />
                          <span style={{ fontSize: 10, color: C.dim }}>{discountType === 'percent' ? '%' : 'R$'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Botão remover desconto */}
                  {(discountVal > 0) && (
                    <button style={{ width: '100%', marginTop: 6, padding: '4px', borderRadius: 5, border: 'none', background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit' }}
                      onClick={() => { setDiscount(''); setItemDiscounts({}); setShowDiscountPanel(false); }}>
                      Remover desconto
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Forma de pagamento */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {payMethods.map(pm => (
                <button key={pm.id} onClick={() => setPayment(pm.id)}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    background: payment === pm.id ? 'rgba(255,215,64,.15)' : 'transparent',
                    border: `1px solid ${payment === pm.id ? C.gold : C.brd}`,
                    color: payment === pm.id ? C.gold : C.dim,
                  }}>
                  {pm.label}
                </button>
              ))}
            </div>

            {/* Totais */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.dim, marginBottom: 4 }}>
              <span>Subtotal:</span><span>R$ {subtotal.toFixed(2)}</span>
            </div>
            {discountVal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.red, marginBottom: 4 }}>
                <span style={{ fontSize: 10 }}>{discountLabel || 'Desconto'}:</span><span>- R$ {discountVal.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 900, color: C.grn, marginBottom: 10 }}>
              <span>TOTAL:</span><span>R$ {total.toFixed(2)}</span>
            </div>

            {/* Botão finalizar */}
            <button style={{ ...btnGold, opacity: cart.length === 0 || finishing ? 0.5 : 1 }}
              onClick={finishSale} disabled={cart.length === 0 || finishing}>
              {finishing ? '⏳ Finalizando...' : '✅ Finalizar Venda'}
            </button>
          </div>
  );

  // ─── LAYOUT ───
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

      {/* Header */}
      <div style={{ padding: 'calc(10px + env(safe-area-inset-top)) 12px 10px', borderBottom: `1px solid ${C.brd}`, background: C.s1, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.gold, whiteSpace: 'nowrap', flexShrink: 0 }}>🛒 Nova Venda</div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'right', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {customer
            ? <span style={{ fontSize: 11, color: C.grn, background: 'rgba(0,230,118,.1)', padding: '4px 10px', borderRadius: 6 }}>👤 {customer.name}</span>
            : (!isMobile && customerPhone && <span style={{ fontSize: 11, color: C.dim }}>📱 {customerPhone.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4')}</span>)}
        </div>
        <button style={{ ...btnOutline, padding: '8px 14px', fontSize: 12, flexShrink: 0 }} onClick={onClose}>✕ Fechar</button>
      </div>

      {isMobile ? (
        <>
          {/* Abas Produtos | Carrinho */}
          <div style={{ display: 'flex', background: C.s1, borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
            {[
              { id: 'produtos', label: '🔍 Produtos' },
              { id: 'carrinho', label: `🛒 Carrinho${cart.length ? ` (${cart.length})` : ''} — R$ ${total.toFixed(2)}` },
            ].map(t => (
              <button key={t.id} onClick={() => setMobileTab(t.id)}
                style={{ flex: 1, padding: '13px 6px', background: 'transparent', border: 'none',
                  borderBottom: mobileTab === t.id ? `2px solid ${C.gold}` : '2px solid transparent',
                  color: mobileTab === t.id ? C.gold : C.dim, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.label}
              </button>
            ))}
          </div>
          {mobileTab === 'produtos' ? searchSection : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: C.s1 }}>
              {cartItemsSection}
              {checkoutSection}
            </div>
          )}
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {searchSection}
          <div style={{ width: 320, display: 'flex', flexDirection: 'column', background: C.s1, flexShrink: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.brd}`, fontWeight: 700, fontSize: 13, color: C.gold }}>
              🛒 Carrinho ({cart.length} {cart.length === 1 ? 'item' : 'itens'})
            </div>
            {cartItemsSection}
            {checkoutSection}
          </div>
        </div>
      )}
    </div>
  );
}

// Estilos
const inputStyle = { padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,215,64,0.08)', background: '#18181C', color: '#EEEEF0', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', marginBottom: 10, boxSizing: 'border-box' };
const btnGold = { padding: '12px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#FFD740,#FF8F00)', color: '#0A0A0C', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', width: '100%' };
const btnOutline = { padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,215,64,0.15)', background: '#18181C', color: '#EEEEF0', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600 };
const btnMini = { padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,215,64,0.15)', background: '#18181C', color: '#EEEEF0', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 700 };
