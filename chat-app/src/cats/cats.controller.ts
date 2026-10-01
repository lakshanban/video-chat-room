import { Controller, Get } from "@nestjs/common";


@Controller('cats')
export class CatsController {
    @Get()
    findAll(): string[] {
        return ['cat1', 'cat2', 'cat3'];
    }
}
