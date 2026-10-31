import { useState, useEffect } from 'react';
import { MapPin, Save, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LocationPermissionDialog } from '@/components/LocationPermissionDialog';
import { useUserLocation } from '@/hooks/useUserLocation';
import { toast } from '@/hooks/use-toast';

const COMPANY_SETTINGS_TABLE_ID = 89346;

export default function CompanySettingsPage() {
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [savedLocation, setSavedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [settingsId, setSettingsId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  const { status, permissionDenied, requestLocation, dismissPermissionDialog } = useUserLocation();

  // Load existing settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoadingSettings(true);
      const { data, error } = await window.ezsite.apis.tablePage(COMPANY_SETTINGS_TABLE_ID, {
        PageNo: 1,
        PageSize: 1,
        OrderByField: 'id',
        IsAsc: false,
        Filters: []
      });

      if (error) throw error;

      if (data?.List && data.List.length > 0) {
        const settings = data.List[0];
        setSettingsId(settings.id);
        
        if (settings.work_location_latitude && settings.work_location_longitude) {
          setSavedLocation({
            lat: settings.work_location_latitude,
            lng: settings.work_location_longitude
          });
        }
      }
    } catch (error: any) {
      toast({
        title: 'เกิดข้อผิดพลาด',
        description: error?.message || 'ไม่สามารถโหลดข้อมูลการตั้งค่าได้',
        variant: 'destructive'
      });
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const handleGetLocation = async () => {
    const location = await requestLocation();
    if (location) {
      setCurrentLocation(location);
      toast({
        title: 'อ่านตำแหน่งสำเร็จ',
        description: `ละติจูด: ${location.lat.toFixed(6)}, ลองจิจูด: ${location.lng.toFixed(6)}`
      });
    }
  };

  const handleSaveLocation = async () => {
    if (!currentLocation) {
      toast({
        title: 'กรุณาอ่านตำแหน่งก่อน',
        description: 'คุณต้องอ่านตำแหน่ง GPS ปัจจุบันก่อนบันทึก',
        variant: 'destructive'
      });
      return;
    }

    try {
      setIsSaving(true);

      const dataToSave = {
        work_location_latitude: currentLocation.lat,
        work_location_longitude: currentLocation.lng
      };

      let error;

      if (settingsId) {
        // Update existing settings
        const result = await window.ezsite.apis.tableUpdate(COMPANY_SETTINGS_TABLE_ID, {
          id: settingsId,
          ...dataToSave
        });
        error = result.error;
      } else {
        // Create new settings
        const result = await window.ezsite.apis.tableCreate(COMPANY_SETTINGS_TABLE_ID, dataToSave);
        error = result.error;
      }

      if (error) throw new Error(error);

      setSavedLocation(currentLocation);
      toast({
        title: 'บันทึกสำเร็จ',
        description: 'บันทึกตำแหน่งสถานที่ทำงานเรียบร้อยแล้ว'
      });

      // Reload settings to get the ID if it was a create
      await loadSettings();
    } catch (error: any) {
      toast({
        title: 'เกิดข้อผิดพลาด',
        description: error?.message || 'ไม่สามารถบันทึกตำแหน่งได้',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">ตั้งค่าบริษัท</h1>
          <p className="text-slate-600">จัดการข้อมูลและการตั้งค่าบริษัท</p>
        </div>

        {/* Work Location Settings Card */}
        <Card className="shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <CardTitle>ตำแหน่งสถานที่ทำงาน</CardTitle>
                <CardDescription>กำหนดพิกัด GPS สำหรับการเช็คอินเข้างาน</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {isLoadingSettings ? (
              <div className="text-center py-8 text-slate-500">กำลังโหลดข้อมูล...</div>
            ) : (
              <>
                {/* Saved Location Display */}
                {savedLocation && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-green-800 font-semibold">
                      <MapPin className="w-4 h-4" />
                      <span>ตำแหน่งที่บันทึกไว้</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div className="flex flex-col">
                        <span className="text-green-700 font-medium">ละติจูด (Latitude)</span>
                        <span className="text-green-900 font-mono">{savedLocation.lat.toFixed(6)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-green-700 font-medium">ลองจิจูด (Longitude)</span>
                        <span className="text-green-900 font-mono">{savedLocation.lng.toFixed(6)}</span>
                      </div>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${savedLocation.lat},${savedLocation.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-900 hover:underline"
                    >
                      <Navigation className="w-3 h-3" />
                      ดูบน Google Maps
                    </a>
                  </div>
                )}

                {/* Current Location Display */}
                {currentLocation && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-blue-800 font-semibold">
                      <MapPin className="w-4 h-4" />
                      <span>ตำแหน่งปัจจุบัน</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div className="flex flex-col">
                        <span className="text-blue-700 font-medium">ละติจูด (Latitude)</span>
                        <span className="text-blue-900 font-mono">{currentLocation.lat.toFixed(6)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-blue-700 font-medium">ลองจิจูด (Longitude)</span>
                        <span className="text-blue-900 font-mono">{currentLocation.lng.toFixed(6)}</span>
                      </div>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-900 hover:underline"
                    >
                      <Navigation className="w-3 h-3" />
                      ดูบน Google Maps
                    </a>
                  </div>
                )}

                {/* Instructions */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-sm text-amber-800">
                    <strong>วิธีการใช้งาน:</strong> กดปุ่ม "อ่านตำแหน่งปัจจุบัน" เพื่ออ่านพิกัด GPS จากอุปกรณ์ของคุณ
                    จากนั้นกดปุ่ม "บันทึกเป็นสถานที่ทำงาน" เพื่อบันทึกตำแหน่งนี้สำหรับการเช็คอินเข้างาน
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={handleGetLocation}
                    disabled={status === 'loading'}
                    className="flex-1 gap-2"
                    variant="outline"
                  >
                    <Navigation className={`w-4 h-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
                    {status === 'loading' ? 'กำลังอ่านตำแหน่ง...' : 'อ่านตำแหน่งปัจจุบัน'}
                  </Button>
                  <Button
                    onClick={handleSaveLocation}
                    disabled={!currentLocation || isSaving}
                    className="flex-1 gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'กำลังบันทึก...' : 'บันทึกเป็นสถานที่ทำงาน'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Location Permission Dialog */}
      <LocationPermissionDialog
        open={permissionDenied}
        onOpenChange={dismissPermissionDialog}
        onRetry={handleGetLocation}
      />
    </div>
  );
}