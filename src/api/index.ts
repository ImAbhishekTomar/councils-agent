import axios from 'axios';

// Mirrors Councils's axios service. baseURL points at the existing Express
// backend; override with VITE_API_BASE_URL when the LangGraph backend lands.
const baseURL = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

const service = axios.create({
  baseURL,
  timeout: 300000,
  headers: { 'Content-Type': 'application/json' },
});

service.interceptors.request.use(
  (config) => {
    const locale = typeof localStorage !== 'undefined' ? localStorage.getItem('locale') : null;
    if (locale) config.headers['Accept-Language'] = locale;
    return config;
  },
  (error) => Promise.reject(error),
);

service.interceptors.response.use(
  (response) => {
    const res = response.data;
    if (res && res.success === false) {
      return Promise.reject(new Error(res.error || res.message || 'Error'));
    }
    return res;
  },
  (error) => Promise.reject(error),
);

export default service;
