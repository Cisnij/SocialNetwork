from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0028_setting_default_post_privacy'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='event_id',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='notification',
            name='vote_id',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
