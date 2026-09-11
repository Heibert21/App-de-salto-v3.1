/**
 * AthleteService — CRUD contra MockAPI.io
 * Endpoint: https://6aa407a4e7ae868cdf7b9838.mockapi.io/athletes
 */

const BASE_URL = 'https://6aa407a4e7ae868cdf7b9838.mockapi.io/athletes';

export interface RemoteAthlete {
  id: string;
  name: string;
  weightKg: number;
  heightCm: number;
  createdAt?: string;
}

export const AthleteService = {

  /** Obtiene todos los atletas */
  async getAll(): Promise<RemoteAthlete[]> {
    const res = await fetch(BASE_URL);
    if (!res.ok) throw new Error(`Error al obtener atletas: ${res.status}`);
    return res.json();
  },

  /** Crea un nuevo atleta */
  async create(data: Omit<RemoteAthlete, 'id' | 'createdAt'>): Promise<RemoteAthlete> {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Error al crear atleta: ${res.status}`);
    return res.json();
  },

  /** Actualiza un atleta existente */
  async update(id: string, data: Partial<Omit<RemoteAthlete, 'id' | 'createdAt'>>): Promise<RemoteAthlete> {
    const res = await fetch(`${BASE_URL}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Error al actualizar atleta: ${res.status}`);
    return res.json();
  },

  /** Elimina un atleta */
  async delete(id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Error al eliminar atleta: ${res.status}`);
  },
};
