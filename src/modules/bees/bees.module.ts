import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bee } from '../../entities/bee.entity';
import { BeesService } from './bees.service';
import { BeesController } from './bees.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bee])],
  controllers: [BeesController],
  providers: [BeesService],
  exports: [BeesService],
})
export class BeesModule {}
