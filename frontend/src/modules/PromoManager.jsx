import { useState, useEffect, useRef } from 'react';
import api from '../api';

const W = { border: '#e9edef', txt: '#111b21', txt2: '#667781', green: '#00a884', red: '#ea0038', bgHeader: '#f0f2f5' };

export default function PromoManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [category, setCategory] = useState('');
  const [promoPrice, setPromoPrice] = useState('');
  const [expandedItem, setExpandedItem] = useState(null); // id do item expandido pra ver fotos
  const [photos, setPhotos] = useState({}); // { promoItemId: [photo, ...] }
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoColor, setPhotoColor] = useState('');
  const fileInputRef = useRef(null);
  const searchTimeout = useRef(null);

  useEffect(() => {
    api.getPromoItems().then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const doSearch = (q) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.length < 2) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const products = await api.searchProducts(q);
        const grouped = {};
        for (const p of products) {
          const ref = p.ref || p.sku;
          if (!grouped[ref]) {
            grouped[ref] = {
              ref,
              name: p.name.replace(/\s+(P|M|G|GG|EXG|G1|G2|G3|\d{2})$/i, '').trim(),
              category: p.category || '',
              price: parseFloat(p.price),
              stock: parseInt(p.total_stock) || 0,
              sizes: new Set(),
              colors: new Set(),
            };
          }
          if (p.size) grouped[ref].sizes.add(p.size);
          if (p.color) grouped[ref].colors.add(p.color);
          grouped[ref].stock += parseInt(p.total_stock) || 0;
        }
        setSearchResults(Object.values(grouped).map(g => ({
          ...g,
          sizes: [...g.sizes].join(', '),
          colors: [...g.colors].join(', '),
        })));
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 400);
  };

  const addItem = async (product) => {
    const cat = category || product.category || 'Geral';
    if (items.some(i => i.ref === product.ref)) {
      alert('Este produto ja esta na promocao!');
      return;
    }
    try {
      const item = await api.addPromoItem({
        ref: product.ref,
        category: cat,
        display_name: product.name,
        promo_price: promoPrice ? parseFloat(promoPrice) : null,
      });
      setItems(prev => [...prev, item]);
      setSearchQuery('');
      setSearchResults([]);
      setPromoPrice('');
    } catch (e) { alert(e.message); }
  };

  const toggleActive = async (item) => {
    try {
      await api.updatePromoItem(item.id, { active: !item.active });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, active: !i.active } : i));
    } catch (e) { alert(e.message); }
  };

  const removeItem = async (id) => {
    if (!confirm('Remover este produto da promocao?')) return;
    try {
      await api.deletePromoItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      if (expandedItem === id) setExpandedItem(null);
    } catch (e) { alert(e.message); }
  };

  // ── Fotos ──
  const togglePhotos = async (itemId) => {
    if (expandedItem === itemId) { setExpandedItem(null); return; }
    setExpandedItem(itemId);
    setPhotoColor('');
    if (!photos[itemId]) {
      try {
        const p = await api.getPromoPhotos(itemId);
        setPhotos(prev => ({ ...prev, [itemId]: p }));
      } catch { setPhotos(prev => ({ ...prev, [itemId]: [] })); }
    }
  };

  const handleFileSelect = async (e, itemId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]; // remove data:image/...;base64,
        const photo = await api.addPromoPhoto(itemId, { color: photoColor, image: base64 });
        setPhotos(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), photo] }));
        setPhotoColor('');
        setUploadingPhoto(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      alert('Erro ao enviar foto: ' + err.message);
      setUploadingPhoto(false);
    }
    e.target.value = '';
  };

  const deletePhoto = async (photoId, itemId) => {
    if (!confirm('Remover esta foto?')) return;
    try {
      await api.deletePromoPhoto(photoId);
      setPhotos(prev => ({ ...prev, [itemId]: (prev[itemId] || []).filter(p => p.id !== photoId) }));
    } catch (e) { alert(e.message); }
  };

  const categories = [...new Set(items.map(i => i.category))].sort();

  const btnStyle = { padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${W.border}`, fontSize: 14, outline: 'none', background: '#fff', color: W.txt };

  const API_BASE = import.meta.env.VITE_API_URL || '';

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Semana de Oportunidade</h2>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24 }}>
        Adicione produtos e fotos de cada cor para a Le apresentar aos clientes. {items.filter(i => i.active).length} produto(s) ativo(s).
      </p>

      {/* Busca no ERP */}
      <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Buscar produto no ERP (nome, SKU, referencia...)"
            value={searchQuery}
            onChange={e => doSearch(e.target.value)}
          />
          <input
            style={{ ...inputStyle, width: 180 }}
            placeholder="Categoria (ex: Calcas)"
            value={category}
            onChange={e => setCategory(e.target.value)}
          />
          <input
            style={{ ...inputStyle, width: 140 }}
            placeholder="Preco promo (R$)"
            type="number"
            step="0.01"
            min="0"
            value={promoPrice}
            onChange={e => setPromoPrice(e.target.value)}
          />
        </div>

        {searching && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Buscando...</p>}

        {searchResults.length > 0 && (
          <div style={{ maxHeight: 300, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
            {searchResults.map((p, idx) => (
              <div key={p.ref} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', background: idx % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 }}>
                    Ref: {p.ref} | R$ {p.price.toFixed(2)} | Tam: {p.sizes || '-'} | Cores: {p.colors || '-'} | Estoque: {p.stock}
                  </div>
                </div>
                <button
                  onClick={() => addItem(p)}
                  disabled={items.some(i => i.ref === p.ref)}
                  style={{
                    ...btnStyle,
                    background: items.some(i => i.ref === p.ref) ? 'rgba(255,255,255,0.1)' : '#1eba8a',
                    color: items.some(i => i.ref === p.ref) ? 'rgba(255,255,255,0.3)' : '#0d1b18',
                  }}
                >
                  {items.some(i => i.ref === p.ref) ? 'Ja adicionado' : 'Adicionar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lista de itens na promo */}
      {loading ? (
        <p style={{ color: 'rgba(255,255,255,0.4)' }}>Carregando...</p>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>
          <p style={{ fontSize: 16 }}>Nenhum produto na promocao</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>Busque produtos acima para adicionar</p>
        </div>
      ) : (
        <>
          {categories.map(cat => {
            const catItems = items.filter(i => i.category === cat);
            return (
              <div key={cat} style={{ marginBottom: 24 }}>
                <h3 style={{ color: '#1eba8a', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  {cat} ({catItems.filter(i => i.active).length}/{catItems.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {catItems.map(item => (
                    <div key={item.id}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 16px', borderRadius: expandedItem === item.id ? '8px 8px 0 0' : 8,
                        background: item.active ? 'rgba(30,186,138,0.08)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${item.active ? 'rgba(30,186,138,0.2)' : 'rgba(255,255,255,0.05)'}`,
                        borderBottom: expandedItem === item.id ? 'none' : undefined,
                        opacity: item.active ? 1 : 0.5,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{item.display_name}</div>
                          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                            Ref: {item.ref}
                            {item.promo_price ? ` | R$ ${parseFloat(item.promo_price).toFixed(2)}` : ' | Sem preco promo'}
                            {photos[item.id] && ` | ${photos[item.id].length} foto(s)`}
                          </div>
                        </div>

                        <input
                          style={{ width: 90, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 13, textAlign: 'center' }}
                          placeholder="R$ promo"
                          type="number"
                          step="0.01"
                          defaultValue={item.promo_price || ''}
                          onBlur={async (e) => {
                            const val = e.target.value ? parseFloat(e.target.value) : null;
                            if (val !== (item.promo_price ? parseFloat(item.promo_price) : null)) {
                              try {
                                await api.updatePromoItem(item.id, { promo_price: val });
                                setItems(prev => prev.map(i => i.id === item.id ? { ...i, promo_price: val } : i));
                              } catch (err) { alert(err.message); }
                            }
                          }}
                        />

                        <button onClick={() => togglePhotos(item.id)} style={{
                          ...btnStyle, padding: '6px 12px',
                          background: expandedItem === item.id ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
                          color: expandedItem === item.id ? '#fff' : 'rgba(255,255,255,0.6)',
                        }}>
                          Fotos
                        </button>

                        <button onClick={() => toggleActive(item)} style={{
                          ...btnStyle, padding: '6px 12px',
                          background: item.active ? 'rgba(30,186,138,0.15)' : 'rgba(255,255,255,0.08)',
                          color: item.active ? '#1eba8a' : 'rgba(255,255,255,0.4)',
                        }}>
                          {item.active ? 'Ativo' : 'Inativo'}
                        </button>

                        <button onClick={() => removeItem(item.id)} style={{
                          ...btnStyle, padding: '6px 12px',
                          background: 'rgba(234,0,56,0.1)', color: '#ea0038',
                        }}>
                          Remover
                        </button>
                      </div>

                      {/* Painel de fotos expandido */}
                      {expandedItem === item.id && (
                        <div style={{
                          padding: 16, background: 'rgba(255,255,255,0.03)',
                          border: `1px solid ${item.active ? 'rgba(30,186,138,0.2)' : 'rgba(255,255,255,0.05)'}`,
                          borderTop: 'none', borderRadius: '0 0 8px 8px',
                        }}>
                          {/* Upload */}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                            <input
                              style={{ ...inputStyle, width: 160, padding: '8px 12px', fontSize: 13 }}
                              placeholder="Cor (ex: Preto)"
                              value={photoColor}
                              onChange={e => setPhotoColor(e.target.value)}
                            />
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={e => handleFileSelect(e, item.id)}
                            />
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploadingPhoto}
                              style={{ ...btnStyle, background: '#1eba8a', color: '#0d1b18', whiteSpace: 'nowrap' }}
                            >
                              {uploadingPhoto ? 'Enviando...' : 'Enviar Foto'}
                            </button>
                          </div>

                          {/* Lista de fotos */}
                          {(photos[item.id] || []).length === 0 ? (
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                              Nenhuma foto. Adicione fotos de cada cor para a Le enviar ao cliente.
                            </p>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                              {(photos[item.id] || []).map(photo => {
                                const restante = (photo.stock_limit || 0) - (photo.stock_sold || 0);
                                const esgotado = photo.stock_limit > 0 && restante <= 0;
                                return (
                                <div key={photo.id} style={{
                                  borderRadius: 8, overflow: 'hidden',
                                  border: esgotado ? '2px solid #ea0038' : '1px solid rgba(255,255,255,0.1)',
                                  background: 'rgba(0,0,0,0.3)',
                                  width: 140,
                                  opacity: esgotado ? 0.5 : 1,
                                }}>
                                  <img
                                    src={`${API_BASE}/api/promo-photos/${photo.id}/image`}
                                    alt={photo.color || 'Foto'}
                                    style={{ width: 140, height: 140, objectFit: 'cover', display: 'block' }}
                                  />
                                  <div style={{ padding: '6px 8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                      <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
                                        {photo.color || 'Sem cor'}
                                      </span>
                                      <button
                                        onClick={() => deletePhoto(photo.id, item.id)}
                                        style={{ background: 'none', border: 'none', color: '#ea0038', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                      >
                                        X
                                      </button>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Estoque:</span>
                                      <input
                                        type="number"
                                        min="0"
                                        defaultValue={photo.stock_limit || 0}
                                        style={{ width: 40, padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, textAlign: 'center' }}
                                        onBlur={async (e) => {
                                          const val = parseInt(e.target.value) || 0;
                                          if (val !== (photo.stock_limit || 0)) {
                                            try {
                                              await api.updatePromoPhoto(photo.id, { stock_limit: val });
                                              setPhotos(prev => ({ ...prev, [item.id]: (prev[item.id] || []).map(p => p.id === photo.id ? { ...p, stock_limit: val } : p) }));
                                            } catch (err) { alert(err.message); }
                                          }
                                        }}
                                      />
                                    </div>
                                    {photo.stock_limit > 0 && (
                                      <div style={{ fontSize: 11, marginTop: 2, color: esgotado ? '#ea0038' : '#1eba8a', fontWeight: 600 }}>
                                        {esgotado ? 'ESGOTADO' : `${photo.stock_sold || 0} vendido(s), ${restante} restante(s)`}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
