import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';

type LocationPermissionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry?: () => void;
};

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export const LocationPermissionDialog = ({ open, onOpenChange, onRetry }: LocationPermissionDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="items-center text-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-2">
          <MapPin className="w-7 h-7 text-amber-600" />
        </div>
        <DialogTitle>กรุณาเปิดสิทธิ์การเข้าถึงตำแหน่ง</DialogTitle>
        <DialogDescription asChild>
          {isAndroid ? (
            <div className="text-left space-y-3">
              <p>ระบบไม่สามารถลงเวลาได้เนื่องจากไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (GPS) กรุณาทำตาม 3 ขั้นตอนนี้:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>ตรวจสอบว่าเปิด Location/GPS ระดับเครื่องแล้ว: ไปที่ Settings {'>'} Location แล้วเปิดสวิตช์ให้เป็นสีเขียว</li>
                <li>
                  ไปที่ Settings {'>'} Apps {'>'} เลือก "เบราว์เซอร์ที่ใช้เปิดเว็บนี้จริง" (เช่น Chrome — ไม่ใช่ไอคอนที่เพิ่มไว้หน้าจอโฮม)
                  {' > '}Permissions {'>'} Location {'>'} เลือกอนุญาต
                </li>
                <li>
                  หากยังไม่ได้ ให้กดไอคอนรูปกุญแจ/โล่ที่แถบที่อยู่ (address bar) ของ Chrome ในหน้าเว็บนี้ {'>'} Permissions/สิทธิ์การเข้าถึง
                  {' > '}Location {'>'} เปลี่ยนจาก Block เป็น Allow แล้วรีเฟรชหน้าใหม่ (เพราะเว็บไซต์นี้อาจเคยถูกบล็อกไว้เฉพาะเว็บ
                  แยกจากสิทธิ์ระดับแอป Chrome ทั้งตัว)
                </li>
              </ol>
              <p className="text-sm text-muted-foreground">
                หากเดิมเปิดเว็บนี้ผ่านเบราว์เซอร์ของค่ายมือถือ แนะนำให้เปิดผ่าน Chrome แทน แล้วกด "เพิ่มไปยังหน้าจอหลัก" ใหม่
                เพื่อให้แอปขอสิทธิ์ตำแหน่งแยกต่างหากได้อย่างถูกต้อง จากนั้นลองใหม่อีกครั้ง
              </p>
              <p className="text-sm text-muted-foreground">
                ห้ามเปิดลิงก์นี้ผ่าน in-app browser ของ LINE, Facebook หรือ Messenger เพราะเบราว์เซอร์ในแอปเหล่านี้ไม่รองรับการขอสิทธิ์ตำแหน่ง
                กรุณาคัดลอกลิงก์ไปเปิดใน Chrome โดยตรง
              </p>
            </div>
          ) : (
            <p>
              ระบบไม่สามารถลงเวลาได้เนื่องจากไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (GPS) กรุณาไปที่ตั้งค่าเบราว์เซอร์/แอป
              {' > '}สิทธิ์การเข้าถึง {' > '}ตำแหน่ง (Location) แล้วเปิดอนุญาตให้เว็บไซต์นี้ จากนั้นลองใหม่อีกครั้ง
            </p>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="sm:justify-center gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
        {onRetry && (
          <Button onClick={() => { onOpenChange(false); onRetry(); }}>ลองใหม่อีกครั้ง</Button>
        )}
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
