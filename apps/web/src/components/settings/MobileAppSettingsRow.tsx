import { APP_STORE_URL, GOOGLE_PLAY_URL } from "~/branding";
import { AndroidIcon, AppleIcon } from "../Icons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { QRCodeSvg } from "../ui/qr-code";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const stores = [
  { label: "iPhone and iPad", store: "App Store", url: APP_STORE_URL, Icon: AppleIcon },
  { label: "Android", store: "Google Play", url: GOOGLE_PLAY_URL, Icon: AndroidIcon },
].flatMap((store) => (store.url === null ? [] : [{ ...store, url: store.url }]));

/** Hidden until Astrolabe has a store listing to link. */
export function MobileAppSettingsRow() {
  if (stores.length === 0) return null;
  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      description="Connect to your server from your phone or tablet."
      control={
        <div className="flex items-center gap-2">
          {stores.map(({ label, store, url, Icon }) => (
            <Popover key={store}>
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                <Icon />
                {label}
              </PopoverTrigger>
              <PopoverPopup align="end">
                <div className="flex flex-col items-center gap-3">
                  <PopoverTitle>{store}</PopoverTitle>
                  <p className="text-xs text-muted-foreground">Scan with your phone camera.</p>
                  <div className="rounded-lg bg-white p-1.5">
                    <QRCodeSvg
                      value={url}
                      size={128}
                      level="M"
                      marginSize={1}
                      title={`${store} link`}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<a href={url} target="_blank" rel="noreferrer noopener" />}
                  >
                    Open {store}
                  </Button>
                </div>
              </PopoverPopup>
            </Popover>
          ))}
        </div>
      }
    />
  );
}
