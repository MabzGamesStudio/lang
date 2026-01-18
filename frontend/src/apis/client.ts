const BASE_URL = 'http://localhost:3000/api';

export async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!response.ok) throw new Error('API Error');
    return response.json();
}