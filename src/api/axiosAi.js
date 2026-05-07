import axios from 'axios'
import { getApiBaseUrl } from './config'
import { AUTH_STORAGE_KEY } from './client'

export const aiAxios = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 120_000,
})

aiAxios.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl()
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      const { token } = JSON.parse(raw)
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
  } catch (_) {}
  return config
})
