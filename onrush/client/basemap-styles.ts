import type { StyleSpecification } from 'maplibre-gl';
import style from '../public/data/reference-style.json';
export async function getStyleForProvider(): Promise<StyleSpecification> { return style as StyleSpecification; }
