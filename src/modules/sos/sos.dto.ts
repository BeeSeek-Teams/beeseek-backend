import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class DispatchSosDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  batteryLevel: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;
}
