export interface WallboxPowerState {
  powerW: number;
  solarPowerW: number;
  charging: boolean;
  pluggedIn: boolean;
  sunMode: boolean;
  energyTotal?: number;
}