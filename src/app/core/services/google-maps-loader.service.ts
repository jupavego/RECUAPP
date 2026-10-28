import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

declare global {
  interface Window {
    __onGoogleMapsLoaded?: () => void;
  }
}

/** Carga el script de Google Maps JavaScript API una única vez, sin importar cuántos mapas se monten. */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private loadPromise: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<void>((resolve, reject) => {
      if (!environment.googleMapsApiKey) {
        reject(new Error('Falta googleMapsApiKey en el environment'));
        return;
      }
      if (typeof google !== 'undefined' && google.maps) {
        resolve();
        return;
      }

      window.__onGoogleMapsLoaded = () => resolve();

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}&loading=async&callback=__onGoogleMapsLoaded`;
      script.async = true;
      script.onerror = () => reject(new Error('No se pudo cargar Google Maps'));
      document.head.appendChild(script);
    });

    // Si falla, el siguiente intento vuelve a cargar en vez de heredar el rechazo.
    this.loadPromise.catch(() => { this.loadPromise = null; });
    return this.loadPromise;
  }
}
