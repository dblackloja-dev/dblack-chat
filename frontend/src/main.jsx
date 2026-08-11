import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// iOS (PWA instalado): quando o teclado fecha, o WebKit às vezes deixa a página
// deslocada pra cima, revelando uma faixa do fundo na parte de baixo da tela.
// Força a página de volta pra posição normal ao sair de um campo de texto.
const resetViewport = () => setTimeout(() => window.scrollTo(0, 0), 50);
document.addEventListener('focusout', resetViewport);
window.addEventListener('orientationchange', resetViewport);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
