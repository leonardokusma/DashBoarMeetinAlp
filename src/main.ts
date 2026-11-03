import './styles.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado.');

mountApp(root);
