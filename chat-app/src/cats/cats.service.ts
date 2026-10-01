import { Injectable } from "@nestjs/common";

@Injectable()
export class CatsService {
    findAll(): string[] {
        return ['cat1', 'cat2', 'cat3'];
    }
}
