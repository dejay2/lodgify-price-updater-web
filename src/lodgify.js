import axios from 'axios';

const BASE_V1 = 'https://api.lodgify.com/v1';
const BASE_V2 = 'https://api.lodgify.com/v2';

function client(apiKey) {
  const inst = axios.create({
    headers: {
      Accept: 'application/json',
      'X-ApiKey': apiKey,
      'Content-Type': 'application/*+json',
    },
    timeout: 30_000,
  });
  return inst;
}

export async function fetchProperties(apiKey) {
  const c = client(apiKey);
  const r = await c.get(`${BASE_V1}/properties`);
  return r.data;
}

export async function fetchBookings(apiKey, { start, end, page = 1, size = 50 }) {
  const c = client(apiKey);
  const params = { start, end, page, size, includeCount: true };
  const r = await c.get(`${BASE_V2}/reservations/bookings`, { params });
  return r.data; // { count, items }
}

export async function fetchCalendar(apiKey, houseId, roomTypeId, start, end) {
  const c = client(apiKey);
  const params = { HouseId: houseId, RoomTypeId: roomTypeId, StartDate: start, EndDate: end };
  const r = await c.get(`${BASE_V2}/rates/calendar`, { params });
  const data = r.data;
  if (Array.isArray(data)) return data;
  if (data && data.calendar) return data.calendar;
  return [];
}

export async function postRates(apiKey, payload) {
  const c = client(apiKey);
  const r = await c.post(`${BASE_V1}/rates/savewithoutavailability`, payload);
  return r.data;
}

