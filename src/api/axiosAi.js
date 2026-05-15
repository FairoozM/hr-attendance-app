import axios from 'axios'
import { getApiBaseUrl } from './config'

export const aiAxios = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 120_000,
  withCredentials: true,
})

aiAxios.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl()
  return config
})
