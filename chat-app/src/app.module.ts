import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatsModule } from './cats/cats.module';
import { ChatModule } from './chats/chat.module';

@Module({
  imports: [CatsModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
