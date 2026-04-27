.PHONY: run migrate test shell collectstatic createsuperuser check


run:
	python manage.py runserver --nostatic 0.0.0.0:8000

migrate:
	python manage.py migrate

test:
	python manage.py test

shell:
	python manage.py shell

collectstatic:
	python manage.py collectstatic --noinput

createsuperuser:
	python manage.py createsuperuser

check:
	python manage.py check
