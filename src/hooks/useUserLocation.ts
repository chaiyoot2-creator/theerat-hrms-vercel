import { useCallback, useState } from 'react';
import { toast } from '@/hooks/use-toast';

export type Coordinates = { lat: number; lng: number };

const getBrowserPosition = () =>
  new Promise<GeolocationPosition>((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง (GPS)'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });

// ระยะห่างระหว่าง 2 พิกัด (เมตร) ด้วยสูตร Haversine
export const distanceInMeters = (a: Coordinates, b: Coordinates) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// อ่านพิกัด GPS จริงจากอุปกรณ์ พร้อมจัดการสิทธิ์/ข้อผิดพลาด: permission denied เปิด modal, ที่เหลือแจ้งด้วย toast
export const useUserLocation = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [permissionDenied, setPermissionDenied] = useState(false);

  const requestLocation = useCallback(async (): Promise<Coordinates | null> => {
    setStatus('loading');
    try {
      const pos = await getBrowserPosition();
      setStatus('success');
      setPermissionDenied(false);
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e: any) {
      setStatus('error');
      if (e?.code === 1) {
        setPermissionDenied(true);
      } else {
        const message =
          e?.code === 2 ? 'ไม่สามารถหาสัญญาณ GPS ได้ กรุณาตรวจสอบว่าเปิด GPS/บริการตำแหน่งบนอุปกรณ์แล้ว และลองไปยังที่โล่งแจ้งเพื่อรับสัญญาณ' :
          e?.code === 3 ? 'หมดเวลาในการค้นหาตำแหน่ง กรุณาลองใหม่อีกครั้ง' :
          e?.message || 'ไม่สามารถอ่านพิกัด GPS ได้';
        toast({ title: 'เกิดข้อผิดพลาดในการอ่านตำแหน่ง GPS', description: message, variant: 'destructive' });
      }
      return null;
    }
  }, []);

  const dismissPermissionDialog = useCallback(() => setPermissionDenied(false), []);

  return { status, permissionDenied, requestLocation, dismissPermissionDialog };
};
