import User from "../models/User.js";

const userStreams = new Map();

const toId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const writeEvent = (res, event, data) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data || {})}\n\n`);
  } catch {
    // no-op
  }
};

export const registerRealtimeConnection = (userId, res) => {
  const key = toId(userId);
  if (!key) return;
  if (!userStreams.has(key)) userStreams.set(key, new Set());
  userStreams.get(key).add(res);
};

export const unregisterRealtimeConnection = (userId, res) => {
  const key = toId(userId);
  if (!key) return;
  const streams = userStreams.get(key);
  if (!streams) return;
  streams.delete(res);
  if (streams.size === 0) {
    userStreams.delete(key);
  }
};

export const publishRealtimeEventToUsers = (userIds = [], event, payload = {}) => {
  const uniqueIds = [...new Set((userIds || []).map(toId).filter(Boolean))];
  uniqueIds.forEach((id) => {
    const streams = userStreams.get(id);
    if (!streams?.size) return;
    streams.forEach((res) => {
      writeEvent(res, event, payload);
    });
  });
};

export const publishRealtimeEventToUser = (userId, event, payload = {}) => {
  publishRealtimeEventToUsers([userId], event, payload);
};

export const publishRealtimeEventToAll = (event, payload = {}) => {
  userStreams.forEach((streams) => {
    streams.forEach((res) => {
      writeEvent(res, event, payload);
    });
  });
};

export const publishRealtimeEventForLocation = async (
  locationId,
  event,
  payload = {}
) => {
  const audience = await User.find({
    status: "active",
    is_active: true,
    location_ids: locationId,
  }).select("_id");
  publishRealtimeEventToUsers(
    audience.map((item) => item._id),
    event,
    payload
  );
};
