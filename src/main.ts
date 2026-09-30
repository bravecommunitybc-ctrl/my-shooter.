import './ui/styles.css';
import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const game = new Game(canvas, overlay);
game.boot();

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
