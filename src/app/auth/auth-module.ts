import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthRoutingModule } from './auth-routing-module';
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { ForgotPassword } from './forgot-password/forgot-password';
import { ResetPassword } from './reset-password/reset-password';
import { ChangePassword } from './change-password/change-password';
import { VerifyEmailComponent } from './verify-email/verify-email.component';

@NgModule({
  imports: [
    CommonModule,
    AuthRoutingModule,
    LoginComponent,
    RegisterComponent,
    ForgotPassword,
    VerifyEmailComponent,
    ResetPassword,
    ChangePassword
  ],
})
export class AuthModule { }
