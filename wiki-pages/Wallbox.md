# Wallbox

Details: [Docs – Wallbox](https://copiis.github.io/e3dc-4-homey/devices/wallbox/)

Jedes Ladepunkt-Gerät ist ein `evcharger`.

## Funktionen

- Live-Leistung + Solaranteil (W)  
- Steckerstatus, Laden/Sonnenmodus als **Sensoren** (Steuerung über Flows)  
- Fahrzeug-SOC: RSCP, Homey-Auto (`measure_battery`), optional Cloud, Flow „Fahrzeug-SOC setzen“, sonst letzter Wert  
- Ladepriorisierung (Batterie zuerst, Entladen im Sonnen-/Mischmodus, bis SoC)  
- Ladeplaner-Widget  

## Hinweise

- Status per RSCP `REQ_EXTERN_DATA_ALG`  
- Mehrere Wallboxen pro HKW  
- Aktive Ladepläne können ad-hoc Flows überstimmen  
